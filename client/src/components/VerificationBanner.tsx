"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function VerificationBanner() {
  const { user, refresh } = useAuth();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (!user || user.email_verified_at) return null;

  async function resend() {
    setBusy(true);
    setMessage("");
    try {
      await api("/api/auth/resend-verification", { method: "POST" });
      setMessage("Verification email sent. Check the server log if you are running locally.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to send email");
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-bold text-amber-800">Verify your email to unlock cashouts</p>
        {message && <p className="mt-1 text-xs font-semibold text-amber-700">{message}</p>}
      </div>
      <button
        onClick={resend}
        disabled={busy}
        className="shrink-0 rounded-full bg-amber-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-amber-600 disabled:opacity-60"
      >
        {busy ? "Sending..." : "Resend email"}
      </button>
    </div>
  );
}
