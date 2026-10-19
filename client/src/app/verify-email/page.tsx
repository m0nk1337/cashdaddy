"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, getToken } from "@/lib/api";

type Status = "working" | "ok" | "error";

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [status, setStatus] = useState<Status>("working");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        await api("/api/auth/verify-email?token=" + encodeURIComponent(token), {
          auth: false,
        });
        setStatus("ok");
        setMessage("Your email is verified. Cashouts are now unlocked.");
      } catch (e) {
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "Verification failed");
      }
    })();
  }, [token]);

  if (!token) {
    return (
      <div className="animate-in mx-auto flex max-w-md flex-col px-4 py-20 sm:px-6">
        <div className="card text-center">
          <h1 className="text-2xl font-extrabold">Email verification</h1>
          <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
            This link is missing its verification token.
          </p>
          <p className="mt-4 text-sm text-zinc-500">
            <Link href="/login" className="font-bold text-indigo-600 hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in mx-auto flex max-w-md flex-col px-4 py-20 sm:px-6">
      <div className="card text-center">
        <h1 className="text-2xl font-extrabold">Email verification</h1>
        {status === "working" && <p className="mt-4 text-sm text-zinc-500">Verifying...</p>}
        {status === "ok" && (
          <>
            <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
              {message}
            </p>
            <Link href="/dashboard" className="btn-primary mt-6">
              Go to dashboard
            </Link>
          </>
        )}
        {status === "error" && (
          <>
            <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
              {message}
            </p>
            <p className="mt-4 text-sm text-zinc-500">
              {getToken() ? (
                <Link href="/dashboard" className="font-bold text-indigo-600 hover:underline">
                  Back to dashboard
                </Link>
              ) : (
                <Link href="/login" className="font-bold text-indigo-600 hover:underline">
                  Log in
                </Link>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={<p className="py-24 text-center text-zinc-500">Loading...</p>}
    >
      <VerifyInner />
    </Suspense>
  );
}
