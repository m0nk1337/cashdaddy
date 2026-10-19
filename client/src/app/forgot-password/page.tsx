"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/auth/forgot-password", {
        method: "POST",
        body: { email },
        auth: false,
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-in mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <h1 className="text-center text-3xl font-extrabold">Reset your password</h1>
      <p className="mt-2 text-center text-sm text-zinc-500">
        We will email you a secure reset link.
      </p>
      <form onSubmit={onSubmit} className="card mt-8 space-y-4">
        {error && (
          <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
            {error}
          </p>
        )}
        {sent ? (
          <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
            If an account exists for that email, a reset link is on its way. Locally? Check
            the server log.
          </p>
        ) : (
          <>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-zinc-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">
              {busy ? "Sending..." : "Send reset link"}
            </button>
          </>
        )}
        <p className="text-center text-sm text-zinc-500">
          Remembered it?{" "}
          <Link href="/login" className="font-bold text-indigo-600 hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </div>
  );
}
