import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — CashDash",
};

export default function TermsPage() {
  return (
    <div className="animate-in mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-extrabold">Terms of Service</h1>
      <div className="card mt-6 space-y-4 text-sm leading-6 text-zinc-600">
        <p>Last updated: October 2026</p>
        <h2 className="pt-2 text-base font-bold text-zinc-800">1. The service</h2>
        <p>
          CashDash rewards you with credits for completing third-party offers, surveys and
          tasks. Credits can be exchanged for cash payouts once you reach the minimum
          balance of $5.00.
        </p>
        <h2 className="pt-2 text-base font-bold text-zinc-800">2. Accounts</h2>
        <p>
          You must provide accurate information, verify your email, and keep your login
          secure. One account per person — duplicate, fake or fraudulent accounts are
          suspended and forfeit unpaid balances.
        </p>
        <h2 className="pt-2 text-base font-bold text-zinc-800">3. Earnings &amp; payouts</h2>
        <p>
          Offer rewards are credited when our partners confirm a completion. Completions
          can be reversed by a partner (for example when an offer is cancelled) and the
          corresponding credits are deducted. Payouts are processed after review, usually
          within 24 hours.
        </p>
        <h2 className="pt-2 text-base font-bold text-zinc-800">4. Fair use</h2>
        <p>
          Cheating includes bots, VPNs used to fake location, self-referrals, chargebacks
          of completed offers, and any manipulation of offer flows. We may withhold
          earnings obtained this way.
        </p>
        <h2 className="pt-2 text-base font-bold text-zinc-800">5. Changes</h2>
        <p>
          We may update these terms; continued use after an update counts as acceptance.
        </p>
      </div>
    </div>
  );
}
