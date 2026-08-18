import { useState, type FormEvent } from "react";
import { useNavigate, Link, Navigate } from "react-router-dom";
import { login, verifyOtp, resendOtp, ApiError } from "../lib/api";
import { validateEmail } from "../lib/authValidation";
import { useAuth } from "../context/AuthContext";
import { Layout } from "../components/Layout";
import { AuthCard } from "../components/AuthCard";
import { OtpStep } from "../components/OtpStep";

export function LoginPage() {
  const navigate = useNavigate();
  const { setAuth, token, ready } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (ready && token) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleCredentials(e: FormEvent) {
    e.preventDefault();
    const emailError = validateEmail(email);
    if (emailError) {
      setError(emailError);
      return;
    }
    if (!password) {
      setError("Email and password are required.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await login(email.trim().toLowerCase(), password);
      setStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  async function handleOtp(code: string) {
    setError(null);
    setPending(true);
    try {
      const result = await verifyOtp(email.trim().toLowerCase(), "login", code);
      setAuth(result.token, result.user);
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
        title={step === "otp" ? "Check your email" : "Log in"}
        subtitle={
          step === "otp"
            ? "Enter the 6-digit login code to finish signing in."
            : "Continue to your API dashboard."
        }
      >
        {step === "credentials" ? (
          <form onSubmit={handleCredentials} className="space-y-4">
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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
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
              {pending ? "Sending code…" : "Continue"}
            </button>
            <p className="text-right text-sm">
              <Link to="/forgot-password" className="link">
                Forgot password?
              </Link>
            </p>
          </form>
        ) : (
          <OtpStep
            email={email.trim().toLowerCase()}
            pending={pending}
            error={error}
            onSubmit={handleOtp}
            onResend={async () => {
              try {
                await resendOtp(email.trim().toLowerCase(), "login");
                setError(null);
              } catch (err) {
                setError(
                  err instanceof ApiError ? err.message : "Could not resend code."
                );
                throw err;
              }
            }}
            onBack={() => {
              setStep("credentials");
              setError(null);
            }}
          />
        )}
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Don&apos;t have an account?{" "}
          <Link to="/signup" className="link">
            Sign up
          </Link>
        </p>
      </AuthCard>
    </Layout>
  );
}
