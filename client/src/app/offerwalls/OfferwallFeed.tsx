"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, formatCents } from "@/lib/api";

interface FeedCampaign {
  key: string;
  type: "offer" | "ptc" | "shortlink" | "task";
  id: string;
  title: string;
  description: string;
  instructions?: string;
  image?: string;
  reward_cents: number;
  countries: string[];
  devices?: string[];
  url?: string;
  duration?: number;
  remaining?: number;
  proof_type?: string;
  proof_text?: string;
}

type Tab = "all" | FeedCampaign["type"];

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "task", label: "Tasks" },
  { id: "offer", label: "Offers" },
  { id: "ptc", label: "Watch & Click" },
  { id: "shortlink", label: "Shortlinks" },
];

const TYPE_BADGES: Record<FeedCampaign["type"], { label: string; className: string }> = {
  task: { label: "Task", className: "bg-sky-100 text-sky-700" },
  offer: { label: "Offer", className: "bg-indigo-100 text-indigo-700" },
  ptc: { label: "Watch", className: "bg-amber-100 text-amber-700" },
  shortlink: { label: "Shortlink", className: "bg-emerald-100 text-emerald-700" },
};

function formatReward(cents: number): string {
  if (cents >= 100) return formatCents(cents);
  return `${cents}¢`;
}

function detectCountry(): string {
  try {
    const region = new Intl.Locale(navigator.language || "en-US").region;
    if (region && /^[A-Za-z]{2}$/.test(region)) return region.toUpperCase();
  } catch {
    /* ignore */
  }
  return "US";
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function LinkifiedText({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/(https?:\/\/[^\s]+)/g), [text]);
  return (
    <p className="mt-1.5 whitespace-pre-line text-sm text-zinc-500">
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all font-medium text-indigo-600 underline"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(new Error("Could not read the image"));
    reader.readAsDataURL(file);
  });
}

async function getCampaigns(wallId: number): Promise<FeedCampaign[]> {
  const country = detectCountry();
  const data = await api<{ campaigns: FeedCampaign[] }>(
    `/api/offerwalls/${wallId}/feed?country=${country}`
  );
  return data.campaigns || [];
}

export default function OfferwallFeed({ wallId, color }: { wallId: number; color: string }) {
  const [campaigns, setCampaigns] = useState<FeedCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const lastFetchRef = useRef(0);
  const [tab, setTab] = useState<Tab>("all");
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [proof, setProof] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    lastFetchRef.current = Date.now();
    getCampaigns(wallId)
      .then((data) => {
        if (cancelled) return;
        setCampaigns(data);
        setError("");
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load tasks");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wallId, reloadKey]);

  useEffect(() => {
    function onFocus() {
      if (Date.now() - lastFetchRef.current < 30_000) return;
      setReloadKey((k) => k + 1);
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  function refresh() {
    setLoading(true);
    setToast(null);
    setReloadKey((k) => k + 1);
  }

  const counts = useMemo(() => {
    const map: Record<Tab, number> = { all: campaigns.length, task: 0, offer: 0, ptc: 0, shortlink: 0 };
    for (const c of campaigns) map[c.type] += 1;
    return map;
  }, [campaigns]);

  const visible = useMemo(
    () => (tab === "all" ? campaigns : campaigns.filter((c) => c.type === tab)),
    [campaigns, tab]
  );

  function startCampaign(campaign: FeedCampaign) {
    if (!campaign.url) return;
    window.open(campaign.url, "_blank", "noopener,noreferrer");
  }

  async function submitTask(campaign: FeedCampaign) {
    if (busy) return;
    if (!proof.trim() && !file) {
      setToast({ kind: "err", text: "Add your proof before submitting." });
      return;
    }
    setBusy(campaign.key);
    setToast(null);
    try {
      const body: { proof?: string; image?: { base64: string; mime: string } } = {};
      if (proof.trim()) body.proof = proof.trim();
      if (file) body.image = { base64: await fileToBase64(file), mime: file.type };
      const result = await api<{ status: string }>(
        `/api/offerwalls/${wallId}/tasks/${campaign.id}/submit`,
        { method: "POST", body }
      );
      setToast({ kind: "ok", text: `Task submitted — status: ${result.status}` });
      setOpenTask(null);
      setProof("");
      setFile(null);
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : "Task submission failed" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-t border-zinc-100 p-4">
      <div className="flex items-center gap-3">
        <div className="no-scrollbar -mx-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-1 pb-1">
          {TABS.map((t) => {
            const disabled = counts[t.id] === 0;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                disabled={disabled && t.id !== "all"}
                className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                  tab === t.id ? "text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                } ${disabled && t.id !== "all" ? "cursor-not-allowed opacity-40" : ""}`}
                style={tab === t.id ? { backgroundColor: color } : undefined}
              >
                {t.label} {counts[t.id] > 0 ? `(${counts[t.id]})` : ""}
              </button>
            );
          })}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="shrink-0 rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-600 hover:bg-zinc-200 disabled:opacity-60"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {toast && (
        <div
          className={`mt-4 rounded-2xl px-4 py-3 text-sm font-semibold ${
            toast.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"
          }`}
        >
          {toast.text}
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{error}</p>
      )}

      {!error && !loading && visible.length === 0 && (
        <p className="mt-4 rounded-2xl bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
          No tasks available right now. Check back soon — new offers drop all day.
        </p>
      )}

      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((campaign) => {
          const badge = TYPE_BADGES[campaign.type];
          const isTask = campaign.type === "task";
          const expanded = openTask === campaign.key;
          return (
            <li
              key={campaign.key}
              className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {campaign.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={campaign.image}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-lg border border-zinc-100 object-cover"
                    />
                  ) : (
                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[10px] font-extrabold ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  )}
                  <div className="min-w-0">
                    {campaign.image && (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.className}`}>
                        {badge.label}
                      </span>
                    )}
                    <h3 className="font-bold leading-snug [overflow-wrap:anywhere]">{campaign.title}</h3>
                  </div>
                </div>
                <span
                  className={`shrink-0 whitespace-nowrap rounded-lg px-2 py-1 text-sm font-extrabold tabular-nums ${
                    campaign.reward_cents > 0
                      ? "bg-emerald-50 text-emerald-600"
                      : "bg-zinc-100 text-zinc-500"
                  }`}
                >
                  {campaign.reward_cents > 0 ? "+" : ""}
                  {formatReward(campaign.reward_cents)}
                </span>
              </div>

              {campaign.description && (
                <p className="mt-1.5 flex-1 text-sm break-words text-zinc-500 [overflow-wrap:anywhere]">
                  {campaign.description}
                </p>
              )}

              {expanded && (
                <div className="mt-3 rounded-xl bg-zinc-50 p-3">
                  {campaign.instructions && <LinkifiedText text={stripHtml(campaign.instructions)} />}
                  {campaign.proof_text && (
                    <p className="mt-2 text-xs font-semibold text-zinc-600">{campaign.proof_text}</p>
                  )}
                  <textarea
                    className="field mt-2 min-h-20 text-sm"
                    placeholder="Paste your proof / username / details"
                    value={proof}
                    onChange={(e) => setProof(e.target.value)}
                  />
                  <div className="mt-2">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-xs text-zinc-500 file:mr-3 file:rounded-full file:border-0 file:bg-zinc-200 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-zinc-700"
                    />
                    <p className="mt-1 text-[11px] text-zinc-400">
                      Optional screenshot (JPG/PNG/WEBP, max 5 MB) if the task asks for one.
                    </p>
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <span className="max-w-full truncate rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-500">
                  {campaign.duration ? `${campaign.duration}s` : campaign.type === "task" ? "Manual review" : "Open & complete"}
                </span>
                {isTask ? (
                  <button
                    onClick={() => setOpenTask(expanded ? null : campaign.key)}
                    className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-all hover:scale-105"
                  >
                    {expanded ? "Close" : "Open task"}
                  </button>
                ) : (
                  <button
                    onClick={() => startCampaign(campaign)}
                    disabled={!campaign.url}
                    className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-all hover:scale-105 disabled:opacity-60"
                  >
                    Start
                  </button>
                )}
              </div>

              {expanded && (
                <button
                  onClick={() => void submitTask(campaign)}
                  disabled={busy === campaign.key}
                  className="mt-3 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-all hover:scale-105 disabled:opacity-60"
                >
                  {busy === campaign.key ? "Submitting..." : "Submit proof"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
