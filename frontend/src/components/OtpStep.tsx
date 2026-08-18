import { useState, type FormEvent } from "react";

export function OtpStep({
  email,
  pending,
  error,
  onSubmit,
  onResend,
  onBack,
}: {
  email: string;
  pending: boolean;
  error: string | null;
  onSubmit: (code: string) => Promise<void> | void;
  onResend: () => Promise<void> | void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [resendHint, setResendHint] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setResendHint(null);
    await onSubmit(code.trim());
  }

  async function handleResend() {
    setResendHint(null);
    try {
      await onResend();
      setResendHint("A new code was sent.");
    } catch {
      setResendHint(null);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        We sent a 6-digit code to{" "}
        <span className="font-medium text-gray-800 dark:text-gray-200">
          {email}
        </span>
        . Until SMTP is configured, the code is printed in the backend terminal.
      </p>
      <div>
        <label htmlFor="otp" className="label">
          Verification code
        </label>
        <input
          id="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
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
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {resendHint && !error && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {resendHint}
        </p>
      )}
      <button type="submit" disabled={pending || code.length !== 6} className="btn-primary w-full">
        {pending ? "Verifying…" : "Verify code"}
      </button>
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={onBack}
          className="text-gray-500 hover:underline dark:text-gray-400"
        >
          Back
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void handleResend()}
          className="link"
        >
          Resend code
        </button>
      </div>
    </form>
  );
}
