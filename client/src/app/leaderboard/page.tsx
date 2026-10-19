"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api, formatCents } from "@/lib/api";

interface Leaderboard {
  top: { username: string; earned: number }[];
  me: { earned: number; rank: number };
}

const rankStyles = [
  "bg-gradient-to-br from-yellow-400 to-amber-500 text-white",
  "bg-gradient-to-br from-zinc-300 to-zinc-400 text-zinc-800",
  "bg-gradient-to-br from-amber-600 to-amber-700 text-white",
];

export default function LeaderboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    api<Leaderboard>("/api/gamification/leaderboard")
      .then(setBoard)
      .catch((e) => setError(e.message));
  }, [user]);

  if (loading || !user) {
    return <p className="py-24 text-center text-zinc-500">Loading...</p>;
  }

  if (error) {
    return (
      <p className="mx-auto mt-24 max-w-md rounded-2xl bg-rose-50 px-4 py-3 text-center text-sm font-semibold text-rose-600">
        {error}
      </p>
    );
  }

  if (!board) {
    return <p className="py-24 text-center text-zinc-500">Loading...</p>;
  }

  const topUsers = new Set(board.top.map((t) => t.username));

  return (
    <div className="animate-in mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="text-center">
        <h1 className="text-3xl font-extrabold">Weekly leaderboard</h1>
        <p className="mt-2 text-zinc-500">
          Top earners every week. Resets every Monday - the race starts fresh.
        </p>
      </div>

      <div className="card mt-6 flex items-center justify-between bg-gradient-to-r from-indigo-600 to-pink-600 text-white">
        <div>
          <p className="text-sm font-semibold text-indigo-100">Your rank this week</p>
          <p className="mt-1 text-4xl font-extrabold tabular-nums">#{board.me.rank}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-indigo-100">You earned</p>
          <p className="mt-1 text-4xl font-extrabold tabular-nums">
            {formatCents(board.me.earned)}
          </p>
        </div>
      </div>

      <div className="card mt-6 !p-0">
        {board.top.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">
            No earnings yet this week - complete an offer to take the top spot.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {board.top.map((entry, i) => {
              const isMe = entry.username === user.username;
              return (
                <li
                  key={entry.username}
                  className={`flex items-center gap-4 px-5 py-4 ${isMe ? "bg-indigo-50" : ""}`}
                >
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-extrabold ${
                      i < 3 ? rankStyles[i] : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate font-bold text-zinc-800">
                    @{entry.username}
                    {isMe && <span className="ml-2 text-xs font-extrabold text-indigo-600">you</span>}
                    {!isMe && topUsers.has(entry.username) && i < 3 && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                        on fire
                      </span>
                    )}
                  </span>
                  <span className="font-extrabold tabular-nums text-emerald-600">
                    {formatCents(entry.earned)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-8 text-center">
        <Link href="/offerwalls" className="btn-primary inline-flex">
          Climb the ranks - start earning
        </Link>
      </div>
    </div>
  );
}
