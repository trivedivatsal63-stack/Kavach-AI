import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Layout } from "../components/Layout";

const features = [
  {
    title: "OpenAI-compatible API",
    body: "Point any OpenAI SDK at the gateway. Real keys, real budgets, live usage — no mock scaffolding.",
  },
  {
    title: "RAG Studio",
    body: "Upload PDFs, DOCX, TXT or Markdown. They're parsed, structure-chunked and embedded into a private vector store you can query in natural language.",
  },
  {
    title: "Credit-based spending",
    body: "Every key carries a real LiteLLM max_budget synced to your balance. Top up anytime and watch spend per key.",
  },
];

export function HomePage() {
  const { token } = useAuth();

  return (
    <Layout>
      <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center gap-8 px-4 py-20 text-center sm:px-6">
        <span className="badge bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400">
          Self-hosted LLM gateway
        </span>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Ship AI features against{" "}
          <span className="bg-gradient-to-r from-indigo-500 to-violet-600 bg-clip-text text-transparent">
            your own models
          </span>
        </h1>
        <p className="max-w-xl text-base text-gray-600 dark:text-gray-400">
          Kavach runs a fully self-hosted stack — vLLM serving qwen2.5-1.5b
          through LiteLLM — with API keys, budgets, usage tracking and a
          private RAG store.
        </p>

        <div className="flex items-center gap-3">
          {token ? (
            <Link to="/dashboard" className="btn-primary">
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link to="/signup" className="btn-primary">
                Create an account
              </Link>
              <Link to="/login" className="btn-secondary">
                Log in
              </Link>
            </>
          )}
          <Link to="/docs" className="btn-secondary">
            Read the docs
          </Link>
        </div>

        <div className="mt-8 grid w-full max-w-4xl gap-4 sm:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="card p-5 text-left">
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>
    </Layout>
  );
}
