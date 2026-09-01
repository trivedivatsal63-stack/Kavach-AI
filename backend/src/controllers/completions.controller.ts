import type { Request, Response } from "express";
import { env } from "../config";
import { getLiveSearchContext } from "../services/liveSearch/liveSearch.service";
import { formatWebContext } from "../services/liveSearch/webCitationFormat";
import { LIVE_SEARCH_TOKEN_BUDGET_STANDALONE } from "../utils/liveSearch.constants";
import { findUserByPresentedApiKey } from "../services/keys.service";
import { assertCanAct } from "../services/accountStatus.service";
import { AppError } from "../middleware/errorHandler";
import { getOrCreateProfile } from "../services/compliance/profile.service";
import { ingestCirculars, listCircularsForRun } from "../services/compliance/circular.service";
import { evaluateCircularSequential } from "../services/compliance/evaluator.service";
import { resolveChatKey } from "../services/rag/chatKeys.service";
import { prisma } from "../models/prisma";

// The real front door for the OpenAI-compatible API — previously developers
// pointed their OpenAI client straight at LiteLLM (see DocsPage.tsx, now
// updated), which meant there was no backend code in that request path at
// all. This proxy is what makes `web_search` possible: it's a thin
// passthrough to LiteLLM using the caller's own key (so LiteLLM's existing
// auth/budget enforcement is entirely unchanged), with one addition — when
// `web_search: true` is set, live search results for the latest user
// message get injected as an extra system message before forwarding.
//
// Every response — success or error — is kept in real OpenAI shape
// (`{error: {message, type}}`, not this app's own `{error: "..."}`
// AppError convention) since real OpenAI SDKs parse errors that way; that's
// why this controller never uses AppError/next() like the rest of the app.

interface OpenAIMessage {
  role: string;
  content?: unknown;
  [key: string]: unknown;
}

function openAIError(res: Response, status: number, message: string, type: string) {
  res.status(status).json({ error: { message, type } });
}

export async function completions(req: Request, res: Response) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      openAIError(res, 401, "Missing bearer token.", "authentication_error");
      return;
    }
    const apiKey = header.slice("Bearer ".length).trim();
    if (!apiKey) {
      openAIError(res, 401, "Missing bearer token.", "authentication_error");
      return;
    }

    const owner = await findUserByPresentedApiKey(apiKey);
    if (owner) {
      try {
        assertCanAct(owner);
      } catch (err) {
        const message =
          err instanceof AppError ? err.message : "This account cannot use the API.";
        const status = err instanceof AppError ? err.status : 403;
        openAIError(res, status, message, "permission_error");
        return;
      }
    }

    const body = (req.body ?? {}) as Record<string, unknown>;

    // OpenAI-compatible compliance path: model harrier-compliance / compliance
    const modelStr = typeof body.model === "string" ? body.model.toLowerCase() : "";
    const isComplianceModel = modelStr.includes("compliance") || body.compliance === true || (body as any).compliance_check === true;
    if (isComplianceModel) {
      if (!owner) {
        openAIError(res, 401, "Invalid API key for compliance check.", "authentication_error");
        return;
      }
      // scope check: allow general or compliance keys; block if expired already handled in findUserByPresentedApiKey
      const sources = Array.isArray((body as any).sources) ? ((body as any).sources as string[]) : ["SEBI", "RBI"];
      const lookbackDays = typeof (body as any).lookbackDays === "number" ? (body as any).lookbackDays : 30;
      const companyProfileId = typeof (body as any).companyProfileId === "string" ? (body as any).companyProfileId : undefined;
      let profileId = companyProfileId;
      if (!profileId) {
        const p = await getOrCreateProfile(owner.id);
        profileId = p.id;
      }
      const profile = await prisma.companyProfile.findUnique({ where: { id: profileId } });
      if (!profile) { openAIError(res, 400, "Company profile not found.", "invalid_request_error"); return; }
      let complianceKey = "";
      try {
        const userRow = await prisma.user.findUnique({ where: { id: owner.id } });
        if (userRow) {
          const k = await resolveChatKey(owner.id, Number(userRow.creditBalanceUsd));
          complianceKey = k.rawKey;
        }
      } catch { complianceKey = ""; }
      await ingestCirculars(sources as any, lookbackDays).catch(() => {});
      const circulars = await listCircularsForRun(sources, lookbackDays);
      const table: any[] = [];
      for (const c of circulars) {
        await evaluateCircularSequential(complianceKey, profile as any, c as any);
        const evals = await prisma.circularEvaluation.findMany({ where: { circularId: c.id, companyProfileId: profileId }, orderBy: { pointIndex: "asc" } });
        table.push({ id: c.id, source: c.source, title: c.title, url: c.sourceUrl, pdfUrl: c.pdfUrl, publishedAt: c.publishedAt, points: evals.map((e) => ({ pointIndex: e.pointIndex, text: e.pointText, applicable: e.applicable, reason: e.reason, deadline: e.deadline, checklist: e.checklist })) });
      }
      const content = JSON.stringify({ total: circulars.length, table }, null, 2);
      res.json({
        id: `chatcmpl-compliance-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        compliance: { total: circulars.length, table },
      });
      return;
    }

    if (body.stream === true) {
      openAIError(
        res,
        400,
        "stream is not supported on this endpoint yet — send a normal (non-streaming) request.",
        "invalid_request_error"
      );
      return;
    }

    const messages = Array.isArray(body.messages) ? (body.messages as OpenAIMessage[]) : null;
    if (!messages || messages.length === 0) {
      openAIError(res, 400, "messages is required.", "invalid_request_error");
      return;
    }

    const webSearch = body.web_search === true;
    let citations: unknown;

    if (webSearch) {
      const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
      const query = typeof lastUserMessage?.content === "string" ? lastUserMessage.content : "";

      const webCitations = query
        ? await getLiveSearchContext({
            query,
            budgetTokens: LIVE_SEARCH_TOKEN_BUDGET_STANDALONE,
          })
        : [];
      citations = webCitations;

      if (webCitations.length > 0) {
        const searchSystemMessage: OpenAIMessage = {
          role: "system",
          content:
            `Live web search results for the user's latest question (real pages, concise excerpts):\n\n${formatWebContext(webCitations)}\n\n` +
            "Rules: use ONLY facts in excerpts; cite per sentence with [n]. If excerpts don't contain the answer, say so. Ignore irrelevant results and answer normally.",
        };
        // Inserted right after any caller-supplied system message(s), or at
        // the very front if none — a caller's own system prompt stays the
        // model's primary instruction, with search results as supplementary
        // context underneath it. This is a generic passthrough over an
        // arbitrary caller-supplied messages array, not a fixed template
        // (unlike RAG's answerQuestion), so injection has to work
        // structurally like this rather than via a Q+context wrapper.
        const firstNonSystemIndex = messages.findIndex((m) => m.role !== "system");
        const insertAt = firstNonSystemIndex === -1 ? messages.length : firstNonSystemIndex;
        messages.splice(insertAt, 0, searchSystemMessage);
      }
    }

    const forwardBody: Record<string, unknown> = { ...body, messages };
    delete forwardBody.web_search;

    const litellmRes = await fetch(`${env.litellmBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(forwardBody),
    });

    const data = await litellmRes.json().catch(() => null);
    if (data === null) {
      openAIError(res, 502, "Inference gateway returned an invalid response.", "api_error");
      return;
    }

    // Non-2xx from LiteLLM (bad key, budget exceeded, model error, ...) —
    // forward its real status and body verbatim rather than reshaping it;
    // it's already in OpenAI error shape.
    if (!litellmRes.ok) {
      res.status(litellmRes.status).json(data);
      return;
    }

    // additive-only field beyond the standard OpenAI response shape —
    // ignored by strict clients, readable by anyone parsing the raw JSON.
    res.status(litellmRes.status).json(
      webSearch ? { ...(data as Record<string, unknown>), citations } : data
    );
  } catch (err) {
    console.error("POST /v1/chat/completions failed:", err);
    openAIError(res, 502, "Failed to reach the inference gateway.", "api_error");
  }
}
