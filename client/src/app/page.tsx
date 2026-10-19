import Link from "next/link";

const steps = [
  {
    title: "Create a free account",
    copy: "Sign up in under a minute. No fees, ever.",
    color: "from-indigo-500 to-violet-500",
  },
  {
    title: "Pick an offerwall",
    copy: "Surveys, app trials, videos and deals from top providers.",
    color: "from-pink-500 to-rose-500",
  },
  {
    title: "Cash out your balance",
    copy: "Request PayPal, gift cards or crypto once you hit $5.",
    color: "from-amber-500 to-orange-500",
  },
];

const walls = [
  { name: "BitLabs", copy: "Branded surveys with instant rewards", color: "#f59e0b" },
  { name: "AdGate Media", copy: "App trials, signups and video offers", color: "#6366f1" },
  { name: "OfferToro", copy: "High-paying deals for bigger wallets", color: "#10b981" },
  { name: "CPX Research", copy: "Mobile-optimized survey network", color: "#ec4899" },
];

const stats = [
  { value: "4", label: "Offerwall partners" },
  { value: "$5", label: "Minimum cashout" },
  { value: "24h", label: "Typical payout review" },
  { value: "$0", label: "Fees to join" },
];

export default function Home() {
  return (
    <div className="animate-in">
      <section className="mx-auto max-w-6xl px-4 pb-20 pt-16 text-center sm:px-6 sm:pt-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-4 py-1.5 text-sm font-semibold text-indigo-700">
          Get paid to complete offers
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-5xl font-extrabold leading-tight tracking-tight sm:text-6xl">
          Turn spare minutes into{" "}
          <span className="bg-gradient-to-r from-indigo-600 via-pink-600 to-amber-500 bg-clip-text text-transparent">
            real cash
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-600">
          CashDaddy pays you for surveys, app trials, videos and mini-tasks from trusted
          offerwall networks. Earn anywhere, cash out anytime you pass $5.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/register" className="btn-primary">
            Start earning now
          </Link>
          <Link href="/offerwalls" className="btn-secondary">
            Browse offerwalls
          </Link>
        </div>
        <div className="mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="card py-5">
              <p className="text-3xl font-extrabold text-indigo-600">{s.value}</p>
              <p className="mt-1 text-xs font-semibold text-zinc-500">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-3xl font-extrabold sm:text-4xl">
          Three steps to your first payout
        </h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {steps.map((step, i) => (
            <div key={step.title} className="card relative transition-transform hover:-translate-y-1">
              <span
                className={`grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${step.color} text-lg font-extrabold text-white shadow-md`}
              >
                {i + 1}
              </span>
              <h3 className="mt-4 text-lg font-bold">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600">{step.copy}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="rounded-[2rem] bg-gradient-to-br from-indigo-600 via-violet-600 to-pink-600 p-8 text-white sm:p-12">
          <h2 className="text-center text-3xl font-extrabold sm:text-4xl">
            Fresh offerwalls, every day
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-indigo-100">
            We partner with established networks so there is always something worth your
            time — wherever you are.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {walls.map((w) => (
              <div key={w.name} className="rounded-3xl bg-white/10 p-5 backdrop-blur">
                <span
                  className="block h-3 w-12 rounded-full"
                  style={{ backgroundColor: w.color }}
                />
                <h3 className="mt-3 font-bold">{w.name}</h3>
                <p className="mt-1 text-sm text-indigo-100">{w.copy}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link
              href="/offerwalls"
              className="inline-flex rounded-full bg-white px-6 py-3 font-bold text-indigo-700 shadow-lg transition-transform hover:scale-105"
            >
              See live offers
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
        <h2 className="text-3xl font-extrabold sm:text-4xl">Ready to get paid?</h2>
        <p className="mx-auto mt-3 max-w-xl text-zinc-600">
          Join free today and complete your first offer in minutes.
        </p>
        <Link href="/register" className="btn-primary mt-6">
          Create my account
        </Link>
      </section>
    </div>
  );
}
