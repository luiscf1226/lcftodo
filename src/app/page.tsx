import { auth } from "@clerk/nextjs/server";
import { CalendarCheck2, History, Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/app");

  const features = [
    {
      icon: Users,
      title: "Para tu equipo",
      body: "Crea un equipo, invita a tus compañeros y planifica proyectos juntos.",
    },
    {
      icon: CalendarCheck2,
      title: "Día a día, semana a semana",
      body: "Planifica tareas por día y sigue su progreso hasta terminarlas.",
    },
    {
      icon: History,
      title: "Historial y exportación",
      body: "Cada cambio queda registrado. Revisa semanas anteriores y exporta a CSV o JSON.",
    },
  ];

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <span className="flex items-center gap-2 font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg">✓</span>
          LCF Todos
        </span>
        <div className="flex items-center gap-2">
          <ThemeToggle compact className="sm:hidden" />
          <ThemeToggle className="hidden sm:inline-flex" />
          <Link href="/sign-in" className="btn-ghost">
            Iniciar sesión
          </Link>
        </div>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center py-16 text-center">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Las tareas de tu equipo, organizadas por día.
        </h1>
        <p className="mt-4 max-w-xl text-base text-pretty text-muted sm:text-lg">
          Proyectos, planes diarios, tableros semanales y un historial completo para todo tu equipo.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/sign-up" className="btn-primary px-5 py-2.5">
            Crear equipo
          </Link>
          <Link href="/sign-in" className="btn-outline px-5 py-2.5">
            Ya tengo una cuenta
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
