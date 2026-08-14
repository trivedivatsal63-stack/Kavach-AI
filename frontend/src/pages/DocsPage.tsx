import { useState } from "react";
import { Layout } from "../components/Layout";
import { CodeBlock } from "../components/CodeBlock";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4001";
const MODEL_NAME = "qwen2.5-1.5b";

const curlExample = `curl ${API_BASE_URL}/v1/chat/completions \\
  -H "Authorization: Bearer <your-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${MODEL_NAME}",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}],
    "web_search": false
  }'`;

const pythonExample = `from openai import OpenAI

client = OpenAI(
    base_url="${API_BASE_URL}/v1",
    api_key="<your-api-key>",
)

response = client.chat.completions.create(
    model="${MODEL_NAME}",
    messages=[{"role": "user", "content": "Say hello in one sentence."}],
    extra_body={"web_search": False},  # True grounds the answer with live web results
)

print(response.choices[0].message.content)`;

const curlWebSearchExample = `curl ${API_BASE_URL}/v1/chat/completions \\
  -H "Authorization: Bearer <your-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${MODEL_NAME}",
    "messages": [{"role": "user", "content": "What happened in the news today?"}],
    "web_search": true
  }'`;

const ragCurlExample = `curl ${API_BASE_URL}/v1/rag/query \\
  -H "Authorization: Bearer <your-rag-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "question": "What does the onboarding doc say about pricing?",
    "documentIds": ["<optional: restrict to specific documents>"],
    "webSearch": false
  }'`;

const ragPythonExample = `import httpx

resp = httpx.post(
    "${API_BASE_URL}/v1/rag/query",
    headers={"Authorization": "Bearer <your-rag-api-key>"},
    json={
        "question": "What does the onboarding doc say about pricing?",
        "webSearch": False,  # True also grounds the answer with live web results
    },
)
print(resp.json()["answer"])
# resp.json()["citations"] holds the source chunks + similarity scores
# resp.json()["webCitations"] holds live web sources, only when webSearch was true`;

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
          : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
      }`}
    >
      {children}
    </button>
  );
}

export function DocsPage() {
  const [lang, setLang] = useState<"curl" | "python">("curl");

  return (
    <Layout>
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Docs</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            The gateway is OpenAI-compatible — point any OpenAI SDK or plain
            HTTP client at it. Generate a real API key from your{" "}
            <a href="/dashboard" className="link">
              dashboard
            </a>{" "}
            first.
          </p>
        </div>

        <div className="card p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Base URL
              </p>
              <code className="mt-1.5 block overflow-x-auto rounded-lg bg-gray-100 px-3 py-2 text-sm dark:bg-gray-800">
                {API_BASE_URL}/v1
              </code>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Model
              </p>
              <code className="mt-1.5 block overflow-x-auto rounded-lg bg-gray-100 px-3 py-2 text-sm dark:bg-gray-800">
                {MODEL_NAME}
              </code>
            </div>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3 dark:border-gray-800">
            <TabButton active={lang === "curl"} onClick={() => setLang("curl")}>
              curl
            </TabButton>
            <TabButton
              active={lang === "python"}
              onClick={() => setLang("python")}
            >
              Python
            </TabButton>
          </div>
          <div className="p-5">
            <CodeBlock code={lang === "curl" ? curlExample : pythonExample} />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Live web search</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Set <code className="rounded bg-gray-100 px-1 py-0.5 text-[13px] dark:bg-gray-800">web_search: true</code>{" "}
              on any request to ground the answer with real, live-fetched web
              results — self-hosted (no third-party search API), and never
              triggered automatically. Off by default.
            </p>
          </div>
          <div className="card overflow-hidden">
            <div className="p-5">
              <CodeBlock code={curlWebSearchExample} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">RAG query API</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Ask questions over the documents you uploaded in the{" "}
              <a href="/rag" className="link">
                RAG Studio
              </a>
              . Authenticate with a RAG API key (created there) — spend comes
              out of your credit balance, enforced via the key&apos;s real
              LiteLLM budget. Add{" "}
              <code className="rounded bg-gray-100 px-1 py-0.5 text-[13px] dark:bg-gray-800">webSearch: true</code>{" "}
              to also ground the answer with live web results when your
              documents alone might be out of date.
            </p>
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3 dark:border-gray-800">
              <TabButton
                active={lang === "curl"}
                onClick={() => setLang("curl")}
              >
                curl
              </TabButton>
              <TabButton
                active={lang === "python"}
                onClick={() => setLang("python")}
              >
                Python
              </TabButton>
            </div>
            <div className="p-5">
              <CodeBlock
                code={lang === "curl" ? ragCurlExample : ragPythonExample}
              />
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
