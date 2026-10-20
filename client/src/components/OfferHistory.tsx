"use client";

import { useEffect, useState } from "react";
import { api, formatCents } from "@/lib/api";

type SessionStatus = "pending" | "credited" | "expired" | "failed";

interface OfferSession {
  id: string;
  campaign_type: "offer" | "ptc" | "shortlink" | "task";
  campaign_title: string;
  expected_cents: number;
  status: SessionStatus;
  credited_cents: number;
  txn_id: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<SessionStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-amber-100 text-amber-700" },
  credited: { label: "Credited", className: "bg-emerald-100 text-emerald-700" },
  expired: { label: "Expired", className: "bg-zinc-100 text-zinc-500" },
  failed: { label: "Reversed", className: "bg-rose-100 text-rose-600" },
};

const TYPE_LABELS: Record<OfferSession["campaign_type"], string> = {
  offer: "Offer",
  ptc: "Watch & Click",
  shortlink: "Shortlink",
  task: "Task",
};

function rewardText(session: OfferSession): string {
  if (session.status === "credited" && session.credited_cents > 0) {
    return `+${formatCents(session.credited_cents)}`;
  }
  if (session.expected_cents > 0) return formatCents(session.expected_cents);
  return "—";
}

export default function OfferHistory() {
  const [sessions, setSessions] = useState<OfferSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api<{ sessions: OfferSession[] }>("/api/offerwalls/sessions")
        .then((d) => {
          if (cancelled) return;
          setSessions(d.sessions || []);
          setError("");
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "Could not load offers");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="card mt-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold">My offers</h2>
        {sessions.some((s) => s.status === "pending") && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
            {sessions.filter((s) => s.status === "pending").length} pending
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-zinc-500">
        Every offer you start is tracked here until the network confirms your reward.
      </p>

      {error && (
        <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
          {error}
        </p>
      )}

      {!error && loading && <p className="mt-4 text-sm text-zinc-400">Loading your offers...</p>}

      {!error && !loading && sessions.length === 0 && (
        <p className="mt-4 rounded-2xl bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-500">
          No offers yet. Head to the earn page and start one — you will see its status here.
        </p>
      )}

      {!error && sessions.length > 0 && (
        <ul className="mt-4 divide-y divide-zinc-100">
          {sessions.map((session) => {
            const status = STATUS_STYLES[session.status];
            return (
              <li key={session.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold [overflow-wrap:anywhere]">
                    {session.campaign_title}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <span>{TYPE_LABELS[session.campaign_type]}</span>
                    <span>·</span>
                    <span>{new Date(session.created_at).toLocaleString()}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-extrabold tabular-nums text-zinc-700">
                    {rewardText(session)}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.className}`}>
                    {status.label}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
