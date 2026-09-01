import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError, forgotPassword, resetPassword } from "../lib/api";
import {
  validateEmail,
  validateOtp,
  validatePassword,
  validatePasswordConfirm,
} from "../lib/authValidation";
import { useAuth } from "../context/AuthContext";
import { Layout } from "../components/Layout";
import { AuthCard } from "../components/AuthCard";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { token, ready } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [step, setStep] = useState<"email" | "reset">("email");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (ready && token) {
    return <Navigate to="/chat" replace />;
  }

  async function handleEmail(e: FormEvent) {
    e.preventDefault();
    const emailError = validateEmail(email);
    if (emailError) {
      setError(emailError);
      return;
    }
    setError(null);
    setPending(true);
    try {
      await forgotPassword(email.trim().toLowerCase());
      setInfo(
        "If that email has an account, a 6-digit reset code was sent. Until SMTP is configured, check the backend terminal."
      );
      setStep("reset");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    const nextError =
      validateOtp(code) ||
      validatePassword(password, "New password") ||
      validatePasswordConfirm(password, confirm);
    if (nextError) {
      setError(nextError);
      return;
    }
    setError(null);
    setPending(true);
    try {
      await resetPassword(email.trim().toLowerCase(), code.trim(), password);
      navigate("/login");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Layout>
      <AuthCard
        title={step === "email" ? "Forgot password" : "Set a new password"}
        subtitle={
          step === "email"
            ? "We’ll email a 6-digit code if that address has an account."
            : `Enter the code sent to ${email.trim().toLowerCase()} and choose a new password.`
        }
      >
        {step === "email" ? (
          <form onSubmit={(e) => void handleEmail(e)} className="space-y-4">
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
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="btn-primary w-full"
            >
              {pending ? "Sending…" : "Send reset code"}
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void handleReset(e)} className="space-y-4">
            {info && (
              <p className="text-sm text-gray-500 dark:text-gray-400">{info}</p>
            )}
            <div>
              <label htmlFor="otp" className="label">
                Reset code
              </label>
              <input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="input tracking-[0.4em] font-mono text-center text-lg"
                placeholder="000000"
              />
            </div>
            <div>
              <label htmlFor="password" className="label">
                New password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="At least 8 characters, letters and a number"
              />
            </div>
            <div>
              <label htmlFor="confirm" className="label">
                Confirm new password
              </label>
              <input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="input"
                placeholder="Re-enter your password"
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
              {pending ? "Updating…" : "Update password"}
            </button>
            <button
              type="button"
              className="w-full text-sm text-gray-500 hover:underline dark:text-gray-400"
              onClick={() => {
                setStep("email");
                setError(null);
                setInfo(null);
              }}
            >
              Use a different email
            </button>
          </form>
        )}
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Remembered it?{" "}
          <Link to="/login" className="link">
            Log in
          </Link>
        </p>
      </AuthCard>
    </Layout>
  );
}
