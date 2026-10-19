import Link from "next/link";

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-zinc-100 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-zinc-500 sm:flex-row sm:px-6">
        <p>
          <span className="font-bold text-zinc-700">CashDash</span> — earn rewards for
          completing offers.
        </p>
        <div className="flex items-center gap-4">
          <Link href="/terms" className="hover:text-zinc-800">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-zinc-800">
            Privacy
          </Link>
          <p>Demo project. Offerwall postbacks are simulated.</p>
        </div>
      </div>
    </footer>
  );
}
