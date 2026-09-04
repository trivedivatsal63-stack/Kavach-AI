import {
  completeChat,
  completeChatWithTools,
  StreamAborted,
  type ToolChatMessage,
  type ToolDefinition,
} from "../rag/completion.service";
import { getLiveSearchContext } from "../liveSearch/liveSearch.service";
import { fetchPageText } from "../liveSearch/fetchPage.service";
import { formatWebCitation } from "../liveSearch/webCitationFormat";
import { PAGE_FETCH_MAX_CHARS } from "../../utils/liveSearch.constants";
import type { WebCitation } from "../liveSearch/types";
import type { SearchDomain } from "../liveSearch/searchDecision.service";
import type { PhaseCallback } from "../pipelinePhases";

// Model-driven tool loop (Phase B). The model — not hardcoded backend
// branching — decides whether to search, what to query, and whether to
// fetch specific pages, up to AGENT_MAX_ITERATIONS rounds. Every failure
// mode degrades to today's behavior: unparsable tool calls are ignored,
// executor errors become tool error text (never exceptions), and callers
// fall back to forced search when the model declines a required lookup.

export const WEB_SEARCH_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the live web for current or external facts you don't reliably know. " +
      "Use for: recent events, news, prices and earnings, specific people, companies " +
      "and products, documentation, and definitions of named programs or terms. " +
      "Do NOT use for greetings, small talk, math, or questions answerable from " +
      "the conversation. Returns numbered excerpts with sources.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Self-contained search-engine query. For people use the exact quoted " +
            "full name plus context (e.g. '\"Mohan Bangde\" Harrier'). For markets " +
            "include ticker and recency (e.g. 'AAPL stock news September 2026').",
        },
        domain: {
          type: "string",
          enum: ["finance", "people", "tech", "general"],
          description: "Question purpose — ranks preferred outlets for the domain.",
        },
      },
      required: ["query"],
    },
  },
};

export const FETCH_PAGE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "fetch_page",
    description:
      "Fetch the full text of a specific search-result URL when its excerpt is " +
      "insufficient. Prefer top-ranked results. Pass the exact URL from a prior web_search result.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Exact result URL to fetch." },
      },
      required: ["url"],
    },
  },
};

export const AGENT_TOOLS: ToolDefinition[] = [WEB_SEARCH_TOOL, FETCH_PAGE_TOOL];
export const AGENT_MAX_ITERATIONS = 3;

export interface AgentLoopResult {
  content: string;
  webCitations: WebCitation[];
  toolCallsMade: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

const VALID_DOMAINS: SearchDomain[] = ["finance", "people", "tech", "general"];

export async function runAgentLoop(input: {
  apiKey: string;
  /** System + history + user messages (RAG callers pre-inject doc context). */
  messages: ToolChatMessage[];
  /** Per web_search call token budget (WITH_RAG for RAG, STANDALONE for chat). */
  webBudgetTokens: number;
  /** RAG doc-citation count — web citations number continuously after it. */
  webCitationStartIndex?: number;
  maxIterations?: number;
  onPhase?: PhaseCallback;
  signal?: AbortSignal;
}): Promise<AgentLoopResult> {
  const working: ToolChatMessage[] = [...input.messages];
  const allWeb: WebCitation[] = [];
  const startIndex = input.webCitationStartIndex ?? 0;
  const max = input.maxIterations ?? AGENT_MAX_ITERATIONS;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let toolCallsMade = 0;
  let finalContent = "";

  const bumpUsage = (p: number, c: number, t: number) => {
    promptTokens += p;
    completionTokens += c;
    totalTokens += t;
  };

  for (let iter = 1; iter <= max; iter++) {
    if (input.signal?.aborted) throw new StreamAborted("");
    await input.onPhase?.("generating");
    const res = await completeChatWithTools(input.apiKey, working, AGENT_TOOLS, {
      signal: input.signal,
    });
    bumpUsage(res.promptTokens, res.completionTokens, res.totalTokens);

    if (res.toolCalls.length === 0) {
      finalContent = res.content;
      break;
    }
    toolCallsMade += res.toolCalls.length;
    await input.onPhase?.("searching");

    working.push({
      role: "assistant",
      content: res.content ?? "",
      tool_calls: res.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.argsText },
      })),
    });

    for (const tc of res.toolCalls) {
      if (input.signal?.aborted) throw new StreamAborted("");
      const text = await executeToolCall(tc.name, tc.argsText, {
        webBudgetTokens: input.webBudgetTokens,
        citationBase: startIndex + allWeb.length,
        collect: (cites) => allWeb.push(...cites),
      });
      working.push({
        role: "tool",
        content: text,
        tool_call_id: tc.id,
        name: tc.name,
      });
    }

    if (iter === max) {
      // Iteration budget spent with lookups still pending — synthesize the
      // final answer from everything gathered, without offering tools again.
      if (input.signal?.aborted) throw new StreamAborted("");
      await input.onPhase?.("generating");
      const final = await completeChat(input.apiKey, working, {});
      bumpUsage(final.promptTokens, final.completionTokens, final.totalTokens);
      finalContent = final.content;
    }
  }

  return {
    content: finalContent,
    webCitations: allWeb,
    toolCallsMade,
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

async function executeToolCall(
  name: string,
  argsText: string,
  ctx: {
    webBudgetTokens: number;
    citationBase: number;
    collect: (cites: WebCitation[]) => void;
  }
): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsText) as Record<string, unknown>;
  } catch {
    return `(tool ${name} failed: arguments were not valid JSON)`;
  }

  if (name === "web_search") {
    const query =
      typeof args.query === "string" && args.query.trim()
        ? args.query.trim().slice(0, 300)
        : "";
    if (!query) return "(web_search failed: empty query)";
    const domain: SearchDomain =
      typeof args.domain === "string" &&
      (VALID_DOMAINS as string[]).includes(args.domain)
        ? (args.domain as SearchDomain)
        : "general";
    try {
      const cites = await getLiveSearchContext({
        query,
        budgetTokens: ctx.webBudgetTokens,
        domain,
      });
      if (cites.length === 0) return `(web_search for "${query}" returned no usable results)`;
      ctx.collect(cites);
      // Number continuations after any pre-existing citations so the
      // model's [n] references stay one stable sequence.
      const numbered = cites.map((c, i) =>
        formatWebCitation(ctx.citationBase + i, c)
      );
      return `Search results for "${query}":\n\n${numbered.join("\n\n")}`;
    } catch (err) {
      console.error("Agent web_search tool failed:", err);
      return `(web_search for "${query}" failed with an error)`;
    }
  }

  if (name === "fetch_page") {
    const url = typeof args.url === "string" ? args.url.trim().slice(0, 2000) : "";
    if (!/^https?:\/\//i.test(url)) return "(fetch_page failed: not a valid http(s) URL)";
    try {
      const text = await fetchPageText(url);
      if (!text || !text.trim()) return `(fetch_page: no readable text at ${url})`;
      return `Page content from ${url}:\n\n${text.slice(0, PAGE_FETCH_MAX_CHARS)}`;
    } catch (err) {
      console.error("Agent fetch_page tool failed:", err);
      return `(fetch_page failed for ${url})`;
    }
  }

  return `(unknown tool "${name}" — available tools: web_search, fetch_page)`;
}
