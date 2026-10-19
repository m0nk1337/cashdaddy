"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/auth-context";
import { formatCents } from "@/lib/api";

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

const links = [
  { href: "/offerwalls", label: "Earn" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/withdraw", label: "Withdraw" },
];

export default function Navbar() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const mounted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <header className="sticky top-0 z-40 border-b border-white/60 bg-white/80 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-pink-500 text-white shadow-md shadow-indigo-300">
            C
          </span>
          <span className="bg-gradient-to-r from-indigo-600 to-pink-600 bg-clip-text text-transparent">
            CashDash
          </span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                pathname === l.href
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              }`}
            >
              {l.label}
            </Link>
          ))}
          {mounted && user?.is_admin && (
            <Link
              href="/admin"
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                pathname === "/admin"
                  ? "bg-amber-100 text-amber-700"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              }`}
            >
              Admin
            </Link>
          )}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          {!loading && mounted && user ? (
            <>
              <Link
                href="/dashboard"
                className="rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-bold text-emerald-700 tabular-nums"
              >
                {formatCents(user.balance_cents)}
              </Link>
              <span className="text-sm font-medium text-zinc-500">@{user.username}</span>
              <button
                onClick={() => {
                  logout();
                  router.push("/");
                }}
                className="rounded-full border border-zinc-200 px-4 py-1.5 text-sm font-semibold text-zinc-600 transition-colors hover:bg-zinc-50"
              >
                Log out
              </button>
            </>
          ) : (
            !loading && (
              <>
                <Link
                  href="/login"
                  className="rounded-full px-4 py-1.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-100"
                >
                  Log in
                </Link>
                <Link
                  href="/register"
                  className="rounded-full bg-gradient-to-r from-indigo-600 to-pink-600 px-4 py-1.5 text-sm font-semibold text-white shadow-md shadow-indigo-300 transition-transform hover:scale-105"
                >
                  Join free
                </Link>
              </>
            )
          )}
        </div>

        <button
          className="grid h-10 w-10 place-items-center rounded-xl border border-zinc-200 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          <span className="sr-only">Menu</span>
          <div className="space-y-1.5">
            <span className="block h-0.5 w-5 bg-zinc-700" />
            <span className="block h-0.5 w-5 bg-zinc-700" />
            <span className="block h-0.5 w-5 bg-zinc-700" />
          </div>
        </button>
      </nav>

      {open && (
        <div className="space-y-1 border-t border-zinc-100 bg-white px-4 py-3 md:hidden">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-xl px-3 py-2.5 font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              {l.label}
            </Link>
          ))}
          {mounted && user?.is_admin && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className="block rounded-xl px-3 py-2.5 font-semibold text-zinc-700 hover:bg-zinc-50"
            >
              Admin
            </Link>
          )}
          <div className="pt-2">
            {!loading && mounted && user ? (
              <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2.5">
                <span className="font-bold text-emerald-700 tabular-nums">
                  {formatCents(user.balance_cents)}
                </span>
                <button
                  onClick={() => {
                    setOpen(false);
                    logout();
                    router.push("/");
                  }}
                  className="text-sm font-semibold text-zinc-600"
                >
                  Log out
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Link
                  href="/login"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-xl border border-zinc-200 px-3 py-2.5 text-center font-semibold text-zinc-700"
                >
                  Log in
                </Link>
                <Link
                  href="/register"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-xl bg-indigo-600 px-3 py-2.5 text-center font-semibold text-white"
                >
                  Join free
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
