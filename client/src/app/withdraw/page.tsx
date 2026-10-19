"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api, formatCents } from "@/lib/api";
import VerificationBanner from "@/components/VerificationBanner";

interface Withdrawal {
  id: number;
  amount_cents: number;
  method: string;
  destination: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  processed_at: string | null;
}

const methods = [
  { value: "paypal", label: "PayPal" },
  { value: "gift_card", label: "Gift card" },
  { value: "crypto", label: "Crypto (USDT)" },
];

const statusStyles: Record<Withdrawal["status"], string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-600",
};

const MIN_CENTS = 500;

export default function WithdrawPage() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [amount, setAmount] = useState((MIN_CENTS / 100).toString());
  const [method, setMethod] = useState("paypal");
  const [destination, setDestination] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    api<{ withdrawals: Withdrawal[] }>("/api/wallet/withdrawals")
      .then((d) => setWithdrawals(d.withdrawals))
      .catch(() => {});
  }, [user]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents < MIN_CENTS) {
      setError(`Minimum withdrawal is ${formatCents(MIN_CENTS)}.`);
      return;
    }
    if (cents > (user?.balance_cents ?? 0)) {
      setError("That is more than your current balance.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ withdrawal: Withdrawal; balance_cents: number }>(
        "/api/wallet/withdraw",
        { method: "POST", body: { amountCents: cents, method, destination } }
      );
      setWithdrawals((prev) => [res.withdrawal, ...prev]);
      setSuccess(
        `Payout requested! ${formatCents(cents)} is on its way to ${destination}. New balance: ${formatCents(res.balance_cents)}`
      );
      setAmount((MIN_CENTS / 100).toString());
      setDestination("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdrawal failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <p className="py-24 text-center text-zinc-500">Loading...</p>;
  }

  const canWithdraw = user.balance_cents >= MIN_CENTS;

  return (
    <div className="animate-in mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-extrabold">Withdraw earnings</h1>
      <p className="mt-1 text-zinc-500">
        Cash out via PayPal, gift card or crypto once you reach{" "}
        {formatCents(MIN_CENTS)}.
      </p>

      <div className="mt-6">
        <VerificationBanner />
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-5">
        <form onSubmit={onSubmit} className="card space-y-4 md:col-span-2">
          <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-pink-600 px-4 py-3 text-white">
            <p className="text-xs font-semibold text-indigo-100">Available balance</p>
            <p className="text-2xl font-extrabold tabular-nums">
              {formatCents(user.balance_cents)}
            </p>
          </div>

          {error && (
            <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
              {error}
            </p>
          )}
          {success && (
            <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
              {success}
            </p>
          )}

          <div>
            <label htmlFor="amount" className="mb-1.5 block text-sm font-semibold text-zinc-700">
              Amount (USD)
            </label>
            <input
              id="amount"
              type="number"
              min={MIN_CENTS / 100}
              step="0.01"
              className="field tabular-nums"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-semibold text-zinc-700">Method</span>
            <div className="grid grid-cols-3 gap-2">
              {methods.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value)}
                  className={`rounded-2xl border px-2 py-2.5 text-xs font-bold transition-colors ${
                    method === m.value
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-zinc-200 text-zinc-500 hover:border-zinc-300"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="destination" className="mb-1.5 block text-sm font-semibold text-zinc-700">
              {method === "paypal" ? "PayPal email" : method === "crypto" ? "USDT wallet (TRC-20)" : "Delivery email"}
            </label>
            <input
              id="destination"
              className="field"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder={method === "paypal" ? "you@example.com" : method === "crypto" ? "T..." : "you@example.com"}
              required
            />
          </div>

          <button
            type="submit"
            disabled={busy || !canWithdraw || !user.email_verified_at}
            className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy
              ? "Submitting..."
              : !user.email_verified_at
                ? "Verify your email first"
                : canWithdraw
                  ? "Request payout"
                  : `Need ${formatCents(MIN_CENTS)} minimum`}
          </button>
        </form>

        <section className="md:col-span-3">
          <h2 className="text-lg font-extrabold">Payout history</h2>
          <div className="card mt-3 !p-0">
            {withdrawals.length === 0 ? (
              <p className="p-5 text-sm text-zinc-500">No payout requests yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {withdrawals.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 px-5 py-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-800">
                        {formatCents(w.amount_cents)} via {w.method}
                      </p>
                      <p className="truncate text-xs text-zinc-400">
                        {w.destination} · {new Date(w.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold capitalize ${statusStyles[w.status]}`}
                    >
                      {w.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-4 text-xs text-zinc-400">
            Requests are reviewed by our team. Approved payouts arrive within 24 hours.
          </p>
          <Link href="/offerwalls" className="mt-4 inline-block text-sm font-bold text-indigo-600 hover:underline">
            Earn more before you cash out
          </Link>
        </section>
      </div>
    </div>
  );
}
