"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api, formatCents } from "@/lib/api";
import OfferwallFeed from "./OfferwallFeed";

interface Offer {
  id: number;
  offerwall_id: number;
  title: string;
  description: string;
  reward_cents: number;
  device: string;
}

interface Offerwall {
  id: number;
  display_name: string;
  description: string;
  color: string;
  mode: "demo" | "live";
  wall_url: string | null;
  has_feed?: boolean;
  offers: Offer[];
}

interface RecentWin {
  user: string;
  amount_cents: number;
  created_at: string;
}

const deviceLabels: Record<string, string> = {
  any: "Any device",
  mobile: "Mobile only",
  pc: "Desktop only",
};

export default function OfferwallsPage() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  const [walls, setWalls] = useState<Offerwall[]>([]);
  const [embedUrls, setEmbedUrls] = useState<Record<string, string>>({});
  const [wins, setWins] = useState<RecentWin[]>([]);
  const [loadError, setLoadError] = useState("");
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    api<{ offerwalls: Offerwall[] }>("/api/offerwalls")
      .then((d) => setWalls(d.offerwalls))
      .catch((e) => setLoadError(e.message));
    api<{ urls: Record<string, string> }>("/api/offerwalls/embed-urls")
      .then((d) => setEmbedUrls(d.urls))
      .catch(() => {});
    api<{ wins: RecentWin[] }>("/api/gamification/recent-wins", { auth: false })
      .then((d) => setWins(d.wins))
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api<{ transactions: { description: string }[] }>("/api/wallet/transactions")
      .then((d) => {
        const ids = new Set<number>();
        for (const wall of walls) {
          for (const offer of wall.offers) {
            if (d.transactions.some((t) => t.description === `Completed: ${offer.title}`)) {
              ids.add(offer.id);
            }
          }
        }
        setCompleted(ids);
      })
      .catch(() => {});
  }, [user, walls]);

  const totalOffers = useMemo(
    () => walls.reduce((sum, w) => sum + w.offers.length, 0),
    [walls]
  );

  async function completeOffer(offer: Offer) {
    if (busyId) return;
    setBusyId(offer.id);
    setToast(null);
    try {
      const result = await api<{ balance_cents: number }>(
        `/api/offerwalls/offers/${offer.id}/complete`,
        { method: "POST" }
      );
      setCompleted((prev) => new Set(prev).add(offer.id));
      setToast({
        kind: "ok",
        text: `Nice! +${formatCents(offer.reward_cents)} added. New balance: ${formatCents(result.balance_cents)}`,
      });
      await refresh();
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusyId(null);
    }
  }

  if (loading || !user) {
    return <p className="py-24 text-center text-zinc-500">Loading...</p>;
  }

  return (
    <div className="animate-in mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-extrabold">Earn</h1>
          <p className="mt-1 text-zinc-500">
            {walls.length === 0
              ? "Fresh ways to earn are on the way."
              : `${totalOffers || ""} offers available right now. Pick one and get paid.`}
          </p>
        </div>
        <div className="rounded-full bg-emerald-100 px-4 py-2 text-sm font-bold text-emerald-700 tabular-nums">
          Balance: {formatCents(user.balance_cents)}
        </div>
      </div>

      {wins.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-emerald-100 bg-emerald-50/60">
          <div className="flex items-center gap-3 overflow-x-auto px-4 py-3">
            <span className="shrink-0 rounded-full bg-emerald-600 px-3 py-1 text-xs font-extrabold text-white">
              Live wins
            </span>
            {wins.slice(0, 8).map((w, i) => (
              <span key={i} className="shrink-0 text-sm font-semibold text-emerald-800">
                {w.user} earned{" "}
                <strong className="tabular-nums">{formatCents(w.amount_cents)}</strong>
                <span className="ml-1 text-xs font-normal text-emerald-600">
                  {new Date(w.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`mt-6 rounded-2xl px-4 py-3 text-sm font-semibold ${
            toast.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"
          }`}
        >
          {toast.text}
        </div>
      )}

      {loadError && (
        <p className="mt-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
          {loadError}
        </p>
      )}

      {walls.length === 0 && !loadError ? (
        <div className="card mt-8 py-12 text-center">
          <h2 className="text-2xl font-extrabold">New earning methods coming soon</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-zinc-500">
            We are wiring up new offers right now. In the meantime you can still earn: claim
            your daily bonus, finish today&apos;s challenge, and invite friends for a cut of
            everything they make.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/dashboard" className="btn-primary">
              Go to my dashboard
            </Link>
            <Link href="/leaderboard" className="btn-secondary">
              Check the leaderboard
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {walls.map((wall) => (
            <section key={wall.id} className="card !p-0 overflow-hidden">
              <div
                className="flex flex-col gap-2 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
                style={{ borderTop: `6px solid ${wall.color}` }}
              >
                <div className="min-w-0">
                  <h2 className="text-xl font-extrabold">{wall.display_name}</h2>
                  <p className="mt-0.5 text-sm text-zinc-500 [overflow-wrap:anywhere]">{wall.description}</p>
                </div>
                <span
                  className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${
                    wall.mode === "live" ? "text-white" : "bg-amber-100 text-amber-700"
                  }`}
                  style={wall.mode === "live" ? { backgroundColor: wall.color } : undefined}
                >
                  {wall.mode === "live" ? "Live" : `Preview - ${wall.offers.length} sample offers`}
                </span>
              </div>
              {wall.mode === "live" ? (
                wall.has_feed ? (
                  <OfferwallFeed wallId={wall.id} color={wall.color} />
                ) : (
                  <div className="border-t border-zinc-100 p-4">
                    {wall.wall_url ? (
                      <iframe
                        src={
                          embedUrls[wall.id] ??
                          wall.wall_url.replace("{userId}", String(user.id))
                        }
                        title={`${wall.display_name} offerwall`}
                        className="h-[640px] w-full rounded-2xl border border-zinc-200"
                      />
                    ) : (
                      <p className="rounded-2xl bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-500">
                        {wall.display_name} is being set up. Check back soon.
                      </p>
                    )}
                  </div>
                )
              ) : (
                <ul className="grid grid-cols-1 gap-px bg-zinc-100 sm:grid-cols-2 lg:grid-cols-3">
                  {wall.offers.map((offer) => {
                    const isDone = completed.has(offer.id);
                    return (
                      <li key={offer.id} className="flex min-w-0 flex-col bg-white p-5">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <h3 className="font-bold leading-snug [overflow-wrap:anywhere]">{offer.title}</h3>
                          <span className="shrink-0 rounded-lg bg-emerald-50 px-2 py-1 text-sm font-extrabold text-emerald-600 tabular-nums">
                            +{formatCents(offer.reward_cents)}
                          </span>
                        </div>
                        <p className="mt-1.5 flex-1 text-sm text-zinc-500 [overflow-wrap:anywhere]">
                          {offer.description}
                        </p>
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-500">
                            {deviceLabels[offer.device] || offer.device}
                          </span>
                          <button
                            onClick={() => completeOffer(offer)}
                            disabled={isDone || busyId === offer.id}
                            className={`rounded-full px-4 py-2 text-sm font-bold transition-all ${
                              isDone
                                ? "cursor-not-allowed bg-zinc-100 text-zinc-400"
                                : "bg-indigo-600 text-white shadow-sm hover:scale-105 disabled:opacity-60"
                            }`}
                          >
                            {isDone
                              ? "Completed"
                              : busyId === offer.id
                                ? "Claiming..."
                                : "Start offer"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {user.is_admin && walls.some((w) => w.mode === "demo") && (
        <p className="mt-8 text-center text-xs text-zinc-400">
          Preview mode: sample offers credit instantly for admins only. Regular users never
          see demo walls - flip walls to Live in the admin panel once a network approves you.
        </p>
      )}
    </div>
  );
}
