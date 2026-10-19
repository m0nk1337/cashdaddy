"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useAuth } from "@/lib/auth-context";

function RegisterInner() {
  const { register } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const ref = params.get("ref") || "";
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await register(username, email, password, ref || undefined);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-in mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <h1 className="text-center text-3xl font-extrabold">Join CashDash free</h1>
      <p className="mt-2 text-center text-sm text-zinc-500">
        Create your account and start earning today.
      </p>
      <form onSubmit={onSubmit} className="card mt-8 space-y-4">
        {ref && (
          <p className="rounded-2xl bg-pink-50 px-4 py-3 text-sm font-semibold text-pink-600">
            You are joining via a friend&apos;s invite — a $0.25 welcome bonus is waiting
            after you verify your email.
          </p>
        )}
        {error && (
          <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
            {error}
          </p>
        )}
        <div>
          <label htmlFor="username" className="mb-1.5 block text-sm font-semibold text-zinc-700">
            Username
          </label>
          <input
            id="username"
            className="field"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="e.g. sunny_earner"
            required
          />
        </div>
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
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-semibold text-zinc-700">
            Password
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
          <p className="mt-1 text-xs text-zinc-400">At least 8 characters.</p>
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">
          {busy ? "Creating account..." : "Create account"}
        </button>
        <p className="text-center text-sm text-zinc-500">
          Already a member?{" "}
          <Link href="/login" className="font-bold text-indigo-600 hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<p className="py-24 text-center text-zinc-500">Loading...</p>}>
      <RegisterInner />
    </Suspense>
  );
}
