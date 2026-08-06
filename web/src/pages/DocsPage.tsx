import { Layout } from "../components/Layout";

const LITELLM_BASE_URL =
  import.meta.env.VITE_LITELLM_BASE_URL ?? "http://localhost:4000";
const MODEL_NAME = "qwen2.5-1.5b";

const curlExample = `curl ${LITELLM_BASE_URL}/v1/chat/completions \\
  -H "Authorization: Bearer <your-api-key>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${MODEL_NAME}",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}]
  }'`;

const pythonExample = `from openai import OpenAI

client = OpenAI(
    base_url="${LITELLM_BASE_URL}/v1",
    api_key="<your-api-key>",
)

response = client.chat.completions.create(
    model="${MODEL_NAME}",
    messages=[{"role": "user", "content": "Say hello in one sentence."}],
)

print(response.choices[0].message.content)`;

export function DocsPage() {
  return (
    <Layout>
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-8 px-4 py-16">
        <div>
          <h1 className="text-2xl font-semibold">API Docs</h1>
          <p className="mt-2 text-sm text-gray-500">
            The gateway is OpenAI-compatible — point any OpenAI SDK or plain
            HTTP client at it. Generate a real API key from your{" "}
            <a href="/dashboard" className="underline">
              dashboard
            </a>{" "}
            first (none is shown here).
          </p>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-500">Base URL</h2>
          <code className="block overflow-x-auto rounded bg-gray-100 px-3 py-2 text-sm dark:bg-gray-900">
            {LITELLM_BASE_URL}/v1
          </code>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-500">Model</h2>
          <code className="block overflow-x-auto rounded bg-gray-100 px-3 py-2 text-sm dark:bg-gray-900">
            {MODEL_NAME}
          </code>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-500">curl</h2>
          <pre className="overflow-x-auto rounded bg-gray-100 p-4 text-xs dark:bg-gray-900">
            <code>{curlExample}</code>
          </pre>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-500">
            Python (OpenAI SDK)
          </h2>
          <pre className="overflow-x-auto rounded bg-gray-100 p-4 text-xs dark:bg-gray-900">
            <code>{pythonExample}</code>
          </pre>
        </div>
      </div>
    </Layout>
  );
}
