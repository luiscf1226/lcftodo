import { auth } from "@clerk/nextjs/server";
import { CalendarCheck2, History, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/app");

  const features = [
    { icon: Users, title: "Built for your team", body: "Create a team, invite teammates, and plan projects together." },
    {
      icon: CalendarCheck2,
      title: "Day by day, week by week",
      body: "Plan todos per day and track them as to do, doing, done or didn't finish.",
    },
    {
      icon: History,
      title: "Full history & export",
      body: "Every change is logged. Review past weeks and export to CSV or JSON.",
    },
  ];

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <span className="flex items-center gap-2 font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg">✓</span>
          LCF Todos
        </span>
        <Link href="/sign-in" className="btn-ghost">
          Sign in
        </Link>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Your team&apos;s todos, planned by the day.
        </h1>
        <p className="mt-4 max-w-xl text-base text-pretty text-muted sm:text-lg">
          Projects, daily plans, weekly boards and a complete history — for you and your team.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/sign-up" className="btn-primary px-5 py-2.5">
            Create your team
          </Link>
          <Link href="/sign-in" className="btn-outline px-5 py-2.5">
            I have an account
          </Link>
        </div>

        <div className="mt-16 grid w-full gap-4 text-left sm:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <div key={title} className="card p-5">
              <Icon className="size-5 text-accent" />
              <h2 className="mt-3 font-medium">{title}</h2>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
