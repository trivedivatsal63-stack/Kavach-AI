import { useState, type FormEvent } from "react";
import { useNavigate, Link, Navigate } from "react-router-dom";
import { signup, ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Layout } from "../components/Layout";
import { AuthCard } from "../components/AuthCard";

export function SignupPage() {
  const navigate = useNavigate();
  const { setAuth, token, ready } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (ready && token) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { token: jwt, user } = await signup(email, password, name);
      setAuth(jwt, user);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Layout>
      <AuthCard
        title="Create an account"
        subtitle="You start with $5.00 of credits to play with."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="label">
              Name
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="Ada Lovelace"
            />
          </div>
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="At least 8 characters"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="btn-primary w-full"
          >
            {pending ? "Creating account…" : "Sign up"}
          </button>
        </form>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Already have an account?{" "}
          <Link to="/login" className="link">
            Log in
          </Link>
        </p>
      </AuthCard>
    </Layout>
  );
}
