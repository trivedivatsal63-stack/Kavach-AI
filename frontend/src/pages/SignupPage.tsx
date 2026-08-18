import { useState, type FormEvent } from "react";
import { useNavigate, Link, Navigate } from "react-router-dom";
import { signup, verifyOtp, resendOtp, ApiError } from "../lib/api";
import {
  validateEmail,
  validateName,
  validatePassword,
  validatePasswordConfirm,
} from "../lib/authValidation";
import { useAuth } from "../context/AuthContext";
import { Layout } from "../components/Layout";
import { AuthCard } from "../components/AuthCard";
import { OtpStep } from "../components/OtpStep";

export function SignupPage() {
  const navigate = useNavigate();
  const { setAuth, token, ready } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [step, setStep] = useState<"form" | "otp">("form");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (ready && token) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleForm(e: FormEvent) {
    e.preventDefault();
    const nextError =
      validateName(name) ||
      validateEmail(email) ||
      validatePassword(password) ||
      validatePasswordConfirm(password, confirm);
    if (nextError) {
      setError(nextError);
      return;
    }
    setError(null);
    setPending(true);
    try {
      await signup(email.trim().toLowerCase(), password, name);
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
      const result = await verifyOtp(email.trim().toLowerCase(), "signup", code);
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
        title={step === "otp" ? "Verify your email" : "Create an account"}
        subtitle={
          step === "otp"
            ? "Enter the 6-digit code to finish creating your account."
            : "You start with $5.00 of credits to play with."
        }
      >
        {step === "form" ? (
          <form onSubmit={(e) => void handleForm(e)} className="space-y-4">
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
                maxLength={80}
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
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="At least 8 characters, letters and a number"
              />
            </div>
            <div>
              <label htmlFor="confirm" className="label">
                Confirm password
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
              {pending ? "Sending code…" : "Sign up"}
            </button>
          </form>
        ) : (
          <OtpStep
            email={email.trim().toLowerCase()}
            pending={pending}
            error={error}
            onSubmit={handleOtp}
            onResend={async () => {
              try {
                await resendOtp(email.trim().toLowerCase(), "signup");
                setError(null);
              } catch (err) {
                setError(
                  err instanceof ApiError ? err.message : "Could not resend code."
                );
                throw err;
              }
            }}
            onBack={() => {
              setStep("form");
              setError(null);
            }}
          />
        )}
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
