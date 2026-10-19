"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/lib/api";

function ResetInner() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: { token, password },
        auth: false,
      });
      setDone(true);
      setTimeout(() => router.push("/login"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="card mx-auto mt-16 max-w-md text-center">
        <h1 className="text-2xl font-extrabold">Reset password</h1>
        <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
          This link is missing its reset token.
        </p>
        <Link href="/forgot-password" className="btn-primary mt-6">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-in mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <h1 className="text-center text-3xl font-extrabold">Choose a new password</h1>
      <form onSubmit={onSubmit} className="card mt-8 space-y-4">
        {error && (
          <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
            {error}
          </p>
        )}
        {done ? (
          <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
            Password updated. Taking you to login...
          </p>
        ) : (
          <>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-zinc-700">
                New password
              </label>
              <input
                id="password"
                type="password"
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div>
              <label htmlFor="confirm" className="mb-1.5 block text-sm font-semibold text-zinc-700">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                className="field"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">
              {busy ? "Updating..." : "Update password"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<p className="py-24 text-center text-zinc-500">Loading...</p>}>
      <ResetInner />
    </Suspense>
  );
}
