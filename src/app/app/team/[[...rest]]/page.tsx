"use client";

import { OrganizationProfile } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { ProjectAccessPanel } from "@/components/ProjectAccessPanel";
import { TeamSettings } from "@/components/TeamSettings";
import { TeamBackupExport } from "@/components/TeamBackupExport";

export default function TeamPage() {
  const me = useQuery(api.projectAccess.me, {});

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-2xl font-semibold">Equipo</h1>
      <p className="mb-5 text-sm text-muted">
        {me?.isAdmin
          ? "Invita personas a proyectos, controla el acceso y administra la configuración del equipo."
          : "Consulta tu equipo y su configuración."}
      </p>
      {me?.isAdmin && (
        <div className="mb-8">
          <ProjectAccessPanel />
        </div>
      )}
      {me && !me.isAdmin && me.restricted && (
        <p className="mb-5 card p-4 text-sm text-muted" role="status">
          {me.grantedProjects
            ? `Tienes acceso a ${me.grantedProjects} ${me.grantedProjects === 1 ? "proyecto" : "proyectos"}. Pide más acceso a un administrador si lo necesitas.`
            : "Todavía no tienes acceso a ningún proyecto. Pide a un administrador que te añada a uno."}
        </p>
      )}
      <TeamSettings />
      <TeamBackupExport />
      <OrganizationProfile
        path="/app/team"
        routing="path"
        appearance={{
          elements: { rootBox: "w-full", cardBox: "w-full max-w-none shadow-none border border-[var(--line)]" },
        }}
      />
    </div>
  );
}
