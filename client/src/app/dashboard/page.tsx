"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api, formatCents } from "@/lib/api";
import VerificationBanner from "@/components/VerificationBanner";

interface Transaction {
  id: number;
  type: "earn" | "withdrawal" | "adjustment" | "referral" | "bonus";
  amount_cents: number;
  description: string;
  created_at: string;
}

interface ReferralInfo {
  referral_code: string;
  referral_count: number;
  total_bonus_cents: number;
}

interface Gamification {
  streak: { count: number; claimed_today: boolean; next_bonus_cents: number };
  level: {
    current: { key: string; name: string; min: number };
    next: { key: string; name: string; min: number } | null;
    progress: number;
  };
  challenge: {
    key: string;
    title: string;
    progress: number;
    needed: number;
    bonus_cents: number;
    claimed_today: boolean;
  };
  achievements: { key: string; title: string; description: string; unlocked_at: string | null }[];
  newly_unlocked: string[];
}

const typeStyles: Record<Transaction["type"], string> = {
  earn: "bg-emerald-100 text-emerald-700",
  withdrawal: "bg-amber-100 text-amber-700",
  adjustment: "bg-indigo-100 text-indigo-700",
  referral: "bg-pink-100 text-pink-700",
  bonus: "bg-orange-100 text-orange-700",
};

const levelGradients: Record<string, string> = {
  bronze: "from-amber-700 to-orange-800",
  silver: "from-zinc-400 to-zinc-500",
  gold: "from-yellow-400 to-amber-500",
  platinum: "from-cyan-400 to-blue-500",
  diamond: "from-indigo-500 to-pink-500",
};

export default function DashboardPage() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txError, setTxError] = useState("");
  const [referral, setReferral] = useState<ReferralInfo | null>(null);
  const [gamification, setGamification] = useState<Gamification | null>(null);
  const [newBadges, setNewBadges] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState("");
  const [gError, setGError] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoMsg, setPromoMsg] = useState("");

  const loadGamification = useCallback(async () => {
    try {
      const d = await api<Gamification>("/api/gamification");
      setGamification(d);
      return d;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    api<{ transactions: Transaction[] }>("/api/wallet/transactions")
      .then((d) => setTransactions(d.transactions))
      .catch((e) => setTxError(e.message));
    api<{ referral: ReferralInfo }>("/api/wallet/referral")
      .then((d) => setReferral(d.referral))
      .catch(() => {});
    api<Gamification>("/api/gamification")
      .then((d) => {
        setGamification(d);
        setNewBadges(d.newly_unlocked ?? []);
      })
      .catch(() => {});
  }, [user]);

  async function copyReferralLink() {
    if (!referral) return;
    const link = `${window.location.origin}/register?ref=${referral.referral_code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy your referral link:", link);
    }
  }

  async function claimStreak() {
    setBusy("streak");
    setGError("");
    try {
      await api("/api/gamification/daily-bonus", { method: "POST" });
      await Promise.all([loadGamification(), refresh()]);
    } catch (e) {
      setGError(e instanceof Error ? e.message : "Claim failed");
    } finally {
      setBusy("");
    }
  }

  async function claimChallenge() {
    setBusy("challenge");
    setGError("");
    try {
      await api("/api/gamification/challenge/claim", { method: "POST" });
      await Promise.all([loadGamification(), refresh()]);
    } catch (e) {
      setGError(e instanceof Error ? e.message : "Claim failed");
    } finally {
      setBusy("");
    }
  }

  async function redeemPromo(e: React.FormEvent) {
    e.preventDefault();
    setPromoMsg("");
    setBusy("promo");
    try {
      const d = await api<{ bonus_cents: number }>("/api/gamification/redeem", {
        method: "POST",
        body: { code: promoCode },
      });
      setPromoMsg(`Added ${formatCents(d.bonus_cents)} to your balance!`);
      setPromoCode("");
      await refresh();
    } catch (e) {
      setPromoMsg(e instanceof Error ? e.message : "Redeem failed");
    } finally {
      setBusy("");
    }
  }

  if (loading || !user) {
    return <p className="py-24 text-center text-zinc-500">Loading...</p>;
  }

  const pendingNext = Math.max(0, 500 - user.balance_cents);

  return (
    <div className="animate-in mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-extrabold">Hey, @{user.username}</h1>
          <p className="mt-1 text-zinc-500">Here is how your wallet is doing today.</p>
        </div>
        <div className="flex gap-3">
          <Link href="/offerwalls" className="btn-primary !px-5 !py-2.5 text-sm">
            Earn more
          </Link>
          <Link href="/withdraw" className="btn-secondary !px-5 !py-2.5 text-sm">
            Withdraw
          </Link>
        </div>
      </div>

      <VerificationBanner />

      {newBadges.length > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-bold text-amber-800">
            Badge{newBadges.length > 1 ? "s" : ""} unlocked: {newBadges.join(", ")}
          </p>
          <button onClick={() => setNewBadges([])} className="text-xs font-bold text-amber-600">
            Dismiss
          </button>
        </div>
      )}

      {gError && (
        <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
          {gError}
        </p>
      )}

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        <div className="card bg-gradient-to-br from-indigo-600 to-pink-600 text-white md:col-span-1">
          <p className="text-sm font-semibold text-indigo-100">Current balance</p>
          <p className="mt-2 text-5xl font-extrabold tabular-nums">
            {formatCents(user.balance_cents)}
          </p>
          <p className="mt-4 text-sm text-indigo-100">
            {pendingNext > 0
              ? `${formatCents(pendingNext)} more until you can cash out`
              : "You are ready to cash out!"}
          </p>
        </div>

        <div className="card">
          <p className="text-sm font-semibold text-zinc-500">Total earned</p>
          <p className="mt-2 text-4xl font-extrabold tabular-nums text-emerald-600">
            {formatCents(user.total_earned_cents)}
          </p>
          <p className="mt-4 text-sm text-zinc-500">Lifetime rewards from completed offers.</p>
        </div>

        <div className="card">
          <p className="text-sm font-semibold text-zinc-500">Cashout threshold</p>
          <p className="mt-2 text-4xl font-extrabold tabular-nums text-amber-500">$5.00</p>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all"
              style={{
                width: `${Math.min(100, (user.balance_cents / 500) * 100).toFixed(0)}%`,
              }}
            />
          </div>
        </div>
      </div>

      {gamification && (
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          <div className="card bg-gradient-to-br from-orange-500 to-rose-600 text-white">
            <p className="text-sm font-semibold text-orange-100">Daily streak</p>
            <p className="mt-2 text-4xl font-extrabold tabular-nums">
              Day {gamification.streak.count}
            </p>
            <p className="mt-2 text-sm text-orange-100">
              {gamification.streak.claimed_today
                ? "Bonus claimed - come back tomorrow!"
                : `Claim ${formatCents(gamification.streak.next_bonus_cents)} now`}
            </p>
            <button
              onClick={claimStreak}
              disabled={gamification.streak.claimed_today || busy === "streak"}
              className="mt-4 w-full rounded-full bg-white px-4 py-2.5 text-sm font-bold text-orange-600 transition-transform hover:scale-105 disabled:scale-100 disabled:opacity-60"
            >
              {gamification.streak.claimed_today
                ? "Claimed today"
                : busy === "streak"
                  ? "Claiming..."
                  : "Claim daily bonus"}
            </button>
          </div>

          <div className={`card bg-gradient-to-br ${levelGradients[gamification.level.current.key] || levelGradients.bronze} text-white`}>
            <p className="text-sm font-semibold text-white/80">Your level</p>
            <p className="mt-2 text-4xl font-extrabold">{gamification.level.current.name}</p>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full rounded-full bg-white transition-all"
                style={{ width: `${gamification.level.progress}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-white/90">
              {gamification.level.next
                ? `${formatCents(gamification.level.next.min - user.total_earned_cents)} to ${gamification.level.next.name}`
                : "Top level reached!"}
            </p>
          </div>

          <div className="card">
            <p className="text-sm font-semibold text-zinc-500">Today&apos;s challenge</p>
            <p className="mt-2 text-xl font-extrabold">{gamification.challenge.title}</p>
            <div className="mt-3 flex gap-2">
              {Array.from({ length: gamification.challenge.needed }).map((_, i) => (
                <span
                  key={i}
                  className={`h-3 flex-1 rounded-full ${
                    i < gamification.challenge.progress
                      ? "bg-emerald-500"
                      : "bg-zinc-100"
                  }`}
                />
              ))}
            </div>
            <p className="mt-2 text-sm text-zinc-500">
              {Math.min(gamification.challenge.progress, gamification.challenge.needed)} of{" "}
              {gamification.challenge.needed} done - reward {formatCents(gamification.challenge.bonus_cents)}
            </p>
            <button
              onClick={claimChallenge}
              disabled={
                gamification.challenge.claimed_today ||
                gamification.challenge.progress < gamification.challenge.needed ||
                busy === "challenge"
              }
              className="btn-primary mt-4 w-full !py-2.5 text-sm disabled:opacity-50"
            >
              {gamification.challenge.claimed_today
                ? "Reward claimed"
                : busy === "challenge"
                  ? "Claiming..."
                  : "Claim reward"}
            </button>
          </div>
        </div>
      )}

      {gamification && (
        <section className="mt-10">
          <div className="flex items-end justify-between">
            <h2 className="text-xl font-extrabold">Achievements</h2>
            <Link href="/leaderboard" className="text-sm font-bold text-indigo-600 hover:underline">
              View leaderboard
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {gamification.achievements.map((a) => (
              <div
                key={a.key}
                className={`card !p-4 text-center ${
                  a.unlocked_at
                    ? "border-2 border-amber-300 bg-gradient-to-b from-amber-50 to-white"
                    : "opacity-60 grayscale"
                }`}
              >
                <div
                  className={`mx-auto grid h-10 w-10 place-items-center rounded-full text-sm font-extrabold ${
                    a.unlocked_at
                      ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white"
                      : "bg-zinc-200 text-zinc-400"
                  }`}
                >
                  {a.unlocked_at ? "★" : "?"}
                </div>
                <p className="mt-2 text-sm font-extrabold">{a.title}</p>
                <p className="mt-1 text-xs text-zinc-400">{a.description}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-xl font-extrabold">Promo code</h2>
        <form onSubmit={redeemPromo} className="card mt-4 flex flex-wrap items-center gap-3">
          <input
            className="field !w-auto flex-1 uppercase"
            placeholder="ENTER CODE"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy === "promo" || !promoCode.trim()}
            className="btn-primary !px-6 !py-2.5 text-sm disabled:opacity-60"
          >
            {busy === "promo" ? "Redeeming..." : "Redeem"}
          </button>
          {promoMsg && <p className="w-full text-sm font-semibold text-indigo-600">{promoMsg}</p>}
        </form>
      </section>

      {referral && (
        <section className="mt-10">
          <div className="card bg-gradient-to-br from-pink-600 to-orange-500 text-white">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-extrabold">Invite friends, earn together</h2>
                <p className="mt-1 max-w-xl text-sm text-pink-100">
                  You get 10% of everything your friends earn, and they get a $0.25 welcome
                  bonus when they verify their email.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <code className="rounded-2xl bg-white/20 px-4 py-2 font-mono text-sm font-bold">
                    {referral.referral_code}
                  </code>
                  <button
                    onClick={copyReferralLink}
                    className="rounded-full bg-white px-4 py-2 text-sm font-bold text-pink-600 transition-transform hover:scale-105"
                  >
                    {copied ? "Copied!" : "Copy invite link"}
                  </button>
                </div>
              </div>
              <div className="flex gap-8 text-center">
                <div>
                  <p className="text-3xl font-extrabold tabular-nums">{referral.referral_count}</p>
                  <p className="mt-1 text-xs font-semibold text-pink-100">Friends joined</p>
                </div>
                <div>
                  <p className="text-3xl font-extrabold tabular-nums">
                    {formatCents(referral.total_bonus_cents)}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-pink-100">Bonus earned</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-xl font-extrabold">Recent activity</h2>
        {txError && (
          <p className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
            {txError}
          </p>
        )}
        <div className="card mt-4 !p-0">
          {transactions.length === 0 && !txError ? (
            <p className="p-6 text-sm text-zinc-500">
              No activity yet.{" "}
              <Link href="/offerwalls" className="font-bold text-indigo-600 hover:underline">
                Complete your first offer
              </Link>{" "}
              to start earning.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {transactions.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-800">
                      {t.description}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {new Date(t.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${typeStyles[t.type]}`}
                    >
                      {t.type}
                    </span>
                    <span
                      className={`text-sm font-extrabold tabular-nums ${
                        t.amount_cents < 0 ? "text-rose-500" : "text-emerald-600"
                      }`}
                    >
                      {t.amount_cents < 0 ? "-" : "+"}
                      {formatCents(Math.abs(t.amount_cents))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
