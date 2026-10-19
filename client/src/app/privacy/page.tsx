import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — CashDash",
};

export default function PrivacyPage() {
  return (
    <div className="animate-in mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-extrabold">Privacy Policy</h1>
      <div className="card mt-6 space-y-4 text-sm leading-6 text-zinc-600">
        <p>Last updated: October 2026</p>
        <h2 className="pt-2 text-base font-bold text-zinc-800">What we collect</h2>
        <p>
          Your username, email address, IP address at registration, earnings history and
          payout details you provide (such as a PayPal email).
        </p>
        <h2 className="pt-2 text-base font-bold text-zinc-800">What partners collect</h2>
        <p>
          When you open an offerwall, the partner network (e.g. AdGate Media, CPX
          Research, BitLabs) may set cookies and process your IP, country and device
          information to serve and measure offers. Their own privacy policies apply to
          that processing.
        </p>
        <h2 className="pt-2 text-base font-bold text-zinc-800">How we use data</h2>
        <p>
          To run your account, credit rewards, prevent fraud (including duplicate
          accounts), process payouts, and meet legal obligations. We never sell your
          personal data.
        </p>
        <h2 className="pt-2 text-base font-bold text-zinc-800">Retention &amp; rights</h2>
        <p>
          We keep account data while your account is active, and as long as required for
          fraud prevention and accounting. You can request access, correction or deletion
          of your data by contacting support.
        </p>
      </div>
    </div>
  );
}
