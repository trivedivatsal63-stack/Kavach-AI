import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Layout } from "../components/Layout";
import { ShieldMark } from "../components/ShieldMark";
import { CodeBlock } from "../components/CodeBlock";

const CURL_EXAMPLE = `curl https://your-gateway/v1/chat/completions \\
  -H "Authorization: Bearer $KAVACH_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen2.5-7b",
    "messages": [{"role": "user", "content": "Summarize this clause..."}]
  }'`;

const flowChat = ["Your app", "Harrier gateway", "LiteLLM", "vLLM"];
const flowRag = ["Your documents", "Chunk + embed", "Qdrant", "Cited answer"];

const features = [
  {
    title: "OpenAI-compatible API",
    body: "Point any OpenAI SDK at the gateway. Real keys, real budgets, live usage — no mock scaffolding.",
    icon: PlugIcon,
  },
  {
    title: "RAG Studio",
    body: "Upload PDFs, DOCX, TXT or Markdown. They're parsed, structure-chunked and embedded into a private vector store you can query in natural language.",
    icon: DocSearchIcon,
  },
  {
    title: "Credit-based spending",
    body: "Every key carries a real LiteLLM max_budget synced to your balance. Top up anytime and watch spend per key.",
    icon: CoinIcon,
  },
];

export function HomePage() {
  const { token } = useAuth();

  return (
    <Layout>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="dot-grid pointer-events-none absolute inset-0 text-gray-400 dark:text-gray-600"
        />
        <div className="relative mx-auto flex w-full max-w-7xl flex-col items-center gap-7 px-4 py-24 text-center sm:px-6 sm:py-28">
          <ShieldMark className="h-16 w-auto drop-shadow-sm sm:h-20" />
          <span className="eyebrow">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            Self-hosted LLM gateway
          </span>
          <h1 className="font-display max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Your models. Your data.{" "}
            <span className="bg-gradient-to-r from-indigo-500 to-violet-600 bg-clip-text text-transparent">
              One shielded gateway.
            </span>
          </h1>
          <p className="max-w-xl text-base text-gray-600 sm:text-lg dark:text-gray-400">
            Harrier runs a fully self-hosted stack — vLLM serving
            qwen2.5-7b through LiteLLM — with API keys, budgets, usage
            tracking and a private RAG store, all on infrastructure you
            control.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {token ? (
              <Link to="/dashboard" className="btn-primary px-5 py-2.5">
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link to="/signup" className="btn-primary px-5 py-2.5">
                  Create an account
                </Link>
                <Link to="/login" className="btn-secondary px-5 py-2.5">
                  Log in
                </Link>
              </>
            )}
            <Link to="/docs" className="btn-secondary px-5 py-2.5">
              Read the docs
            </Link>
          </div>
        </div>
      </section>

      {/* ── Code sample ──────────────────────────────────────────────── */}
      <section className="border-y border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <span className="eyebrow">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              Drop-in
            </span>
            <h2 className="font-display mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              One API, no vendor lock-in
            </h2>
            <p className="mt-3 max-w-md text-sm text-gray-600 dark:text-gray-400">
              Every route speaks the OpenAI schema. Swap the base URL, keep
              your SDK, your prompts and your evals — the only thing that
              changes is who's holding the weights.
            </p>
          </div>
          <CodeBlock code={CURL_EXAMPLE} />
        </div>
      </section>

      {/* ── Architecture strip ───────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6">
        <div className="flex flex-col gap-8 sm:gap-10">
          <FlowRow label="Chat completions" steps={flowChat} />
          <FlowRow label="RAG retrieval" steps={flowRag} />
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section className="border-t border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="eyebrow justify-center">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              What you get
            </span>
            <h2 className="font-display mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              Everything a hosted gateway gives you — none of the data
              leaving home
            </h2>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="card card-hover p-5 text-left"
              >
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-3.5 text-sm font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6">
        <div className="card relative overflow-hidden px-6 py-12 text-center sm:px-12">
          <div
            aria-hidden
            className="dot-grid pointer-events-none absolute inset-0 text-gray-400 dark:text-gray-600"
          />
          <div className="relative">
            <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              Stand up your own gateway
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-gray-600 dark:text-gray-400">
              Free to run on your own hardware. Bring a GPU, or start on CPU
              and scale later.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {token ? (
                <Link to="/dashboard" className="btn-primary px-5 py-2.5">
                  Go to dashboard
                </Link>
              ) : (
                <Link to="/signup" className="btn-primary px-5 py-2.5">
                  Create an account
                </Link>
              )}
              <Link to="/docs" className="btn-secondary px-5 py-2.5">
                Read the docs
              </Link>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}

function FlowRow({ label, steps }: { label: string; steps: string[] }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
      <span className="w-36 shrink-0 text-xs font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-500">
        {label}
      </span>
      <div className="flex flex-1 flex-wrap items-center gap-2.5">
        {steps.map((step, i) => (
          <div key={step} className="flex items-center gap-2.5">
            <span className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 font-mono text-xs text-gray-700 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:text-gray-300">
              {step}
            </span>
            {i < steps.length - 1 && (
              <span className="text-gray-300 dark:text-gray-700" aria-hidden>
                →
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PlugIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M9 3v4M15 3v4M6.5 7h11l-.6 5.5a5 5 0 0 1-4.97 4.5h-.86a5 5 0 0 1-4.97-4.5L6.5 7ZM12 17v4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DocSearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M13 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h8a1.5 1.5 0 0 0 1.5-1.5V9L13 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M13 3v5.5a.5.5 0 0 0 .5.5H19" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="10.5" cy="14.5" r="2.25" stroke="currentColor" strokeWidth="1.6" />
      <path d="m12.7 16.7 1.8 1.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CoinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M14.5 9.7c-.4-.7-1.3-1.2-2.5-1.2-1.5 0-2.7.8-2.7 2s1.2 1.7 2.7 1.9c1.5.2 2.7.7 2.7 1.9s-1.2 2-2.7 2c-1.2 0-2.1-.5-2.5-1.2M12 7.5v1M12 15.5v1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
