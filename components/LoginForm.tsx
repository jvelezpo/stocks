"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dispatchAuthChanged } from "./AuthNav";

type LoginFormProps = {
  nextPath?: string;
};

export function LoginForm({ nextPath }: LoginFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const redirectTo = nextPath && nextPath.startsWith("/") ? nextPath : "/";

  async function handleRequestCode(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const response = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as {
        error?: string;
        expiresInMinutes?: number;
        emailSent?: boolean;
        debugCode?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not send code.");
      }
      setStep("code");
      setInfo(
        data.emailSent
          ? `Code sent to ${email}. It expires in ${data.expiresInMinutes ?? 10} minutes.`
          : `Dev mode: Resend is not configured, check server logs for the code.${data.debugCode ? ` (code: ${data.debugCode})` : ""}`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send code.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = (await response.json()) as {
        error?: string;
        ok?: boolean;
        user?: { id: string; email: string; role: "admin" | "user" | "guest" } | null;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Invalid code.");
      }
      // Tell the navbar immediately so it doesn't keep showing "Sign in"
      // until a manual refresh. The layout persists across router.push,
      // so AuthNav would otherwise keep its stale state.
      setSucceeded(true);
      setInfo(`Signed in as ${data.user?.email ?? email}. Redirecting…`);
      dispatchAuthChanged(data.user ?? null);
      router.push(redirectTo);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-soft">
      <h1 className="text-2xl font-semibold text-zinc-950">Sign in</h1>
      <p className="mt-1 text-sm text-zinc-600">
        {step === "email"
          ? "Enter your email and we'll send you a one-time code."
          : `Enter the 6-digit code sent to ${email}.`}
      </p>

      {step === "email" ? (
        <form className="mt-5 space-y-4" onSubmit={handleRequestCode}>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-zinc-700">Email</span>
            <input
              autoComplete="email"
              className="h-11 w-full rounded-md border border-zinc-200 px-3 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {info ? <p className="text-sm text-emerald-700">{info}</p> : null}
          <button
            className="h-11 w-full rounded-md bg-zinc-950 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50"
            disabled={loading}
            type="submit"
          >
            {loading ? "Sending…" : "Send login code"}
          </button>
        </form>
      ) : (
        <form className="mt-5 space-y-4" onSubmit={handleVerifyCode}>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-zinc-700">6-digit code</span>
            <input
              autoComplete="one-time-code"
              className="h-11 w-full rounded-md border border-zinc-200 px-3 text-center text-xl tracking-[0.5em] outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              required
              type="text"
              value={code}
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {info ? (
            <p
              className={`text-sm ${succeeded ? "rounded-md bg-emerald-50 px-3 py-2 font-medium text-emerald-700 ring-1 ring-emerald-200" : "text-zinc-600"}`}
              role={succeeded ? "status" : undefined}
            >
              {succeeded ? "✓ " : null}
              {info}
            </p>
          ) : null}
          <button
            className="h-11 w-full rounded-md bg-zinc-950 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50"
            disabled={loading || code.length !== 6 || succeeded}
            type="submit"
          >
            {succeeded ? "Signed in ✓ Redirecting…" : loading ? "Verifying…" : "Verify & sign in"}
          </button>
          <div className="flex items-center justify-between text-sm">
            <button
              className="text-zinc-600 underline-offset-2 hover:text-zinc-950 hover:underline"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
              type="button"
            >
              Use a different email
            </button>
            <button
              className="text-zinc-600 underline-offset-2 hover:text-zinc-950 hover:underline disabled:opacity-50"
              disabled={loading}
              onClick={handleRequestCode}
              type="button"
            >
              Resend code
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
