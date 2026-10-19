"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { api, formatCents } from "@/lib/api";

interface AdminStats {
  totalUsers: number;
  totalEarningsCents: number;
  pendingWithdrawals: { total: number; count: number };
  paidOutCents: number;
}

interface AdminWithdrawal {
  id: number;
  user_id: number;
  username: string;
  amount_cents: number;
  method: string;
  destination: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  processed_at: string | null;
}

interface AdminUser {
  id: number;
  username: string;
  email: string;
  balance_cents: number;
  total_earned_cents: number;
  is_admin: boolean;
  created_at: string;
}

interface AdminWall {
  id: number;
  name: string;
  slug: string;
  display_name: string;
  mode: "demo" | "live";
  wall_url: string | null;
  postback_secret: string | null;
  postback_config: Record<string, string> | null;
  offer_count: number;
}

interface PromoCode {
  code: string;
  bonus_cents: number;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  created_at: string;
}

const statusStyles: Record<AdminWithdrawal["status"], string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-600",
};

export default function AdminPage() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [walls, setWalls] = useState<AdminWall[]>([]);
  const [wallDrafts, setWallDrafts] = useState<
    Record<
      number,
      {
        wall_url: string;
        postback_secret: string;
        mode: string;
        display_name: string;
        public_key: string;
        bearer_token: string;
      }
    >
  >({});
  const [savedWallId, setSavedWallId] = useState<number | null>(null);
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [promoDraft, setPromoDraft] = useState({ code: "", bonus: "25", uses: "100" });
  const [promoMsg, setPromoMsg] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [s, w, u, wallsRes, promos] = await Promise.all([
        api<AdminStats>("/api/admin/stats"),
        api<{ withdrawals: AdminWithdrawal[] }>("/api/admin/withdrawals"),
        api<{ users: AdminUser[] }>("/api/admin/users"),
        api<{ offerwalls: AdminWall[] }>("/api/admin/offerwalls"),
        api<{ promoCodes: PromoCode[] }>("/api/admin/promo-codes"),
      ]);
      setStats(s);
      setWithdrawals(w.withdrawals);
      setUsers(u.users);
      setWalls(wallsRes.offerwalls);
      setPromoCodes(promos.promoCodes);
      setWallDrafts(
        Object.fromEntries(
          wallsRes.offerwalls.map((wall) => [
            wall.id,
            {
              wall_url: wall.wall_url || "",
              postback_secret: wall.postback_secret || "",
              mode: wall.mode,
              display_name: wall.display_name || "",
              public_key: wall.postback_config?.public_key || "",
              bearer_token: wall.postback_config?.bearer_token || "",
            },
          ])
        )
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load admin data");
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!user.is_admin) {
      router.replace("/dashboard");
      return;
    }
    (async () => {
      await loadAll();
    })();
  }, [loading, user, router, loadAll]);

  async function processWithdrawal(id: number, action: "approve" | "reject") {
    setBusyId(id);
    try {
      await api(`/api/admin/withdrawals/${id}/${action}`, { method: "POST" });
      await Promise.all([loadAll(), refresh()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  async function saveWall(wall: AdminWall) {
    const draft = wallDrafts[wall.id];
    if (!draft) return;
    setBusyId(wall.id);
    setSavedWallId(null);
    try {
      await api(`/api/admin/offerwalls/${wall.id}`, {
        method: "PATCH",
        body: {
          mode: draft.mode,
          wall_url: draft.wall_url,
          postback_secret: draft.postback_secret,
          display_name: draft.display_name,
          public_key: draft.public_key,
          bearer_token: draft.bearer_token,
        },
      });
      setSavedWallId(wall.id);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save offerwall");
    } finally {
      setBusyId(null);
    }
  }

  async function createPromo(e: React.FormEvent) {
    e.preventDefault();
    setPromoMsg("");
    try {
      const bonusCents = Math.round(parseFloat(promoDraft.bonus) * 100);
      await api("/api/admin/promo-codes", {
        method: "POST",
        body: {
          code: promoDraft.code,
          bonus_cents: bonusCents,
          max_uses: Number(promoDraft.uses) || 100,
        },
      });
      setPromoMsg(`Created ${promoDraft.code.toUpperCase()}`);
      setPromoDraft({ code: "", bonus: "25", uses: "100" });
      await loadAll();
    } catch (err) {
      setPromoMsg(err instanceof Error ? err.message : "Failed to create code");
    }
  }

  if (loading || !user || !user.is_admin) {
    return <p className="py-24 text-center text-zinc-500">Loading...</p>;
  }

  return (
    <div className="animate-in mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-extrabold">Admin panel</h1>
      <p className="mt-1 text-zinc-500">Platform overview and payout approvals.</p>

      {error && (
        <p className="mt-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
          {error}
        </p>
      )}

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <p className="text-sm font-semibold text-zinc-500">Total users</p>
          <p className="mt-1 text-3xl font-extrabold text-indigo-600">
            {stats?.totalUsers ?? "—"}
          </p>
        </div>
        <div className="card">
          <p className="text-sm font-semibold text-zinc-500">Credits paid to users</p>
          <p className="mt-1 text-3xl font-extrabold text-emerald-600">
            {stats ? formatCents(stats.totalEarningsCents) : "—"}
          </p>
        </div>
        <div className="card">
          <p className="text-sm font-semibold text-zinc-500">Pending payouts</p>
          <p className="mt-1 text-3xl font-extrabold text-amber-500">
            {stats ? formatCents(stats.pendingWithdrawals.total) : "—"}
          </p>
          <p className="text-xs text-zinc-400">
            {stats?.pendingWithdrawals.count ?? 0} request(s)
          </p>
        </div>
        <div className="card">
          <p className="text-sm font-semibold text-zinc-500">Paid out</p>
          <p className="mt-1 text-3xl font-extrabold text-pink-600">
            {stats ? formatCents(stats.paidOutCents) : "—"}
          </p>
        </div>
      </div>

      <section className="mt-10">
        <h2 className="text-xl font-extrabold">Withdrawal requests</h2>
        <div className="card mt-4 !p-0">
          {withdrawals.length === 0 ? (
            <p className="p-5 text-sm text-zinc-500">No withdrawal requests.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-100 text-xs uppercase text-zinc-400">
                  <tr>
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Amount</th>
                    <th className="px-5 py-3">Method</th>
                    <th className="px-5 py-3">Destination</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {withdrawals.map((w) => (
                    <tr key={w.id}>
                      <td className="px-5 py-3 font-semibold text-zinc-800">@{w.username}</td>
                      <td className="px-5 py-3 font-bold tabular-nums">
                        {formatCents(w.amount_cents)}
                      </td>
                      <td className="px-5 py-3 capitalize text-zinc-500">{w.method}</td>
                      <td className="max-w-[12rem] truncate px-5 py-3 text-zinc-500">
                        {w.destination}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${statusStyles[w.status]}`}
                        >
                          {w.status}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {w.status === "pending" ? (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => processWithdrawal(w.id, "approve")}
                              disabled={busyId === w.id}
                              className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => processWithdrawal(w.id, "reject")}
                              disabled={busyId === w.id}
                              className="rounded-full bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-200 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="block text-right text-xs text-zinc-400">
                            {w.processed_at ? new Date(w.processed_at).toLocaleDateString() : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-extrabold">Users</h2>
        <div className="card mt-4 !p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-100 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-5 py-3">User</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Balance</th>
                  <th className="px-5 py-3">Total earned</th>
                  <th className="px-5 py-3">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-5 py-3 font-semibold text-zinc-800">
                      @{u.username}
                      {u.is_admin && (
                        <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-600">
                          admin
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-zinc-500">{u.email}</td>
                    <td className="px-5 py-3 font-bold tabular-nums">
                      {formatCents(u.balance_cents)}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-emerald-600">
                      {formatCents(u.total_earned_cents)}
                    </td>
                    <td className="px-5 py-3 text-zinc-400">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-extrabold">Offerwalls</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Paste the wall URL your partner gives you (use{" "}
          <code className="rounded bg-zinc-100 px-1 font-mono text-xs">{"{userId}"}</code>{" "}
          where your user ID belongs, and{" "}
          <code className="rounded bg-zinc-100 px-1 font-mono text-xs">{"{publicKey}"}</code>{" "}
          for signed walls). Switch a wall to Live to embed it for users.
        </p>
        <div className="mt-4 space-y-4">
          {walls.map((wall) => {
            const draft = wallDrafts[wall.id];
            if (!draft) return null;
            return (
              <div key={wall.id} className="card">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-extrabold">{wall.name}</h3>
                    <p className="text-xs text-zinc-400">
                      {wall.slug} · {wall.offer_count} demo offers
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      wall.mode === "live"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    {wall.mode}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-bold text-zinc-500">
                      User-facing name (shown instead of {wall.name})
                    </label>
                    <input
                      className="field"
                      placeholder="e.g. Surveys"
                      value={draft.display_name}
                      onChange={(e) =>
                        setWallDrafts((d) => ({
                          ...d,
                          [wall.id]: { ...d[wall.id], display_name: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-zinc-500">Mode</label>
                    <select
                      className="field"
                      value={draft.mode}
                      onChange={(e) =>
                        setWallDrafts((d) => ({ ...d, [wall.id]: { ...d[wall.id], mode: e.target.value } }))
                      }
                    >
                      <option value="demo">demo</option>
                      <option value="live">live</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-bold text-zinc-500">
                      Wall URL (iframe src)
                    </label>
                    <input
                      className="field font-mono text-xs"
                      placeholder="https://wall.example.com/abc/{userId}"
                      value={draft.wall_url}
                      onChange={(e) =>
                        setWallDrafts((d) => ({ ...d, [wall.id]: { ...d[wall.id], wall_url: e.target.value } }))
                      }
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-bold text-zinc-500">
                      Postback secret
                    </label>
                    <input
                      className="field font-mono text-xs"
                      value={draft.postback_secret}
                      onChange={(e) =>
                        setWallDrafts((d) => ({
                          ...d,
                          [wall.id]: { ...d[wall.id], postback_secret: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-bold text-zinc-500">
                      Public API key (signed walls, e.g. Offerwall.me)
                    </label>
                    <input
                      className="field font-mono text-xs"
                      placeholder="Placement public API key"
                      value={draft.public_key}
                      onChange={(e) =>
                        setWallDrafts((d) => ({
                          ...d,
                          [wall.id]: { ...d[wall.id], public_key: e.target.value },
                        }))
                      }
                    />
                    {wall.slug === "offerwall-me" && (
                      <p className="mt-1 text-xs text-zinc-400">
                        On offerwall.me, set the placement currency to <b>100 units per $1.00 USD</b>{" "}
                        (1 unit = 1 cent), paste the Secret Key above, and use the postback URL below.
                        Links are signed server-side automatically once this key + secret are saved.
                      </p>
                    )}
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs font-bold text-zinc-500">
                      Bearer token / API calls (Offerwall.me on-site feed)
                    </label>
                    <input
                      className="field font-mono text-xs"
                      placeholder="Placement bearer token (API calls)"
                      value={draft.bearer_token}
                      onChange={(e) =>
                        setWallDrafts((d) => ({
                          ...d,
                          [wall.id]: { ...d[wall.id], bearer_token: e.target.value },
                        }))
                      }
                    />
                    <p className="mt-1 text-xs text-zinc-400">
                      With this saved, Offerwall.me offers, PTC ads, shortlinks and tasks are
                      fetched server-side and shown as individual cards on your site — no iframe.
                      Required: domain verified, placement approved, and{" "}
                      <b>Require signed user IDs</b> enabled.
                    </p>
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={() => saveWall(wall)}
                      disabled={busyId === wall.id}
                      className="btn-primary w-full !px-4 !py-2.5 text-sm disabled:opacity-60"
                    >
                      {busyId === wall.id ? "Saving..." : savedWallId === wall.id ? "Saved" : "Save"}
                    </button>
                  </div>
                </div>
                <p className="mt-3 rounded-xl bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-500">
                  Postback URL for {wall.name}: {typeof window !== "undefined" ? window.location.origin : ""}
                  /api/postback/{wall.slug}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-extrabold">Promo codes</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Drop codes on socials or Discord - users redeem them on their dashboard.
        </p>
        <form onSubmit={createPromo} className="card mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-40">
            <label className="mb-1 block text-xs font-bold text-zinc-500">Code</label>
            <input
              className="field uppercase"
              placeholder="SUMMER25"
              value={promoDraft.code}
              onChange={(e) => setPromoDraft((d) => ({ ...d, code: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-zinc-500">Bonus ($)</label>
            <input
              className="field"
              type="number"
              step="0.01"
              min="0.01"
              value={promoDraft.bonus}
              onChange={(e) => setPromoDraft((d) => ({ ...d, bonus: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-zinc-500">Max uses</label>
            <input
              className="field"
              type="number"
              min="1"
              value={promoDraft.uses}
              onChange={(e) => setPromoDraft((d) => ({ ...d, uses: e.target.value }))}
              required
            />
          </div>
          <button type="submit" className="btn-primary !px-5 !py-2.5 text-sm">
            Create code
          </button>
          {promoMsg && <p className="text-sm font-bold text-indigo-600">{promoMsg}</p>}
        </form>
        <div className="card mt-4 !p-0">
          {promoCodes.length === 0 ? (
            <p className="p-5 text-sm text-zinc-500">No promo codes yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-100 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-5 py-3">Code</th>
                  <th className="px-5 py-3">Bonus</th>
                  <th className="px-5 py-3">Uses</th>
                  <th className="px-5 py-3">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {promoCodes.map((p) => (
                  <tr key={p.code}>
                    <td className="px-5 py-3 font-mono font-bold">{p.code}</td>
                    <td className="px-5 py-3 font-bold tabular-nums">
                      {formatCents(p.bonus_cents)}
                    </td>
                    <td className="px-5 py-3 tabular-nums">
                      {p.used_count} / {p.max_uses}
                    </td>
                    <td className="px-5 py-3 text-zinc-500">
                      {p.expires_at ? new Date(p.expires_at).toLocaleDateString() : "never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
