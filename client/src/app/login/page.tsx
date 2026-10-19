"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(username, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-in mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <h1 className="text-center text-3xl font-extrabold">Welcome back</h1>
      <p className="mt-2 text-center text-sm text-zinc-500">
        Log in to check your balance and new offers.
      </p>
      <form onSubmit={onSubmit} className="card mt-8 space-y-4">
        {error && (
          <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
            {error}
          </p>
        )}
        <div>
          <label htmlFor="username" className="mb-1.5 block text-sm font-semibold text-zinc-700">
            Username or email
          </label>
          <input
            id="username"
            className="field"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-semibold text-zinc-700">
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-xs font-bold text-indigo-600 hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">
          {busy ? "Logging in..." : "Log in"}
        </button>
        <p className="text-center text-sm text-zinc-500">
          New here?{" "}
          <Link href="/register" className="font-bold text-indigo-600 hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </div>
  );
}
