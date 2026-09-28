"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { ConvexReactClient, useAction } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../../convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import { APP_HOME_PATH } from "@/lib/routes";
import { showToast } from "./ToastViewport";

// The app-wide Convex client treats pending sessions (signed in, no team yet) as signed out, which
// is right for every team-scoped query. Redeeming a code is the one call that needs to run before
// the user has a team, so onboarding gets its own client authenticated with the pending session.
let pendingClient: ConvexReactClient | null = null;
const usePendingAuth = () => useAuth({ treatPendingAsSignedOut: false });

/**
 * Join a team (and its projects) with an invite code: the fallback when an invitation email
 * never arrives. `pending` is true on onboarding, where the session has no team yet.
 */
export function JoinWithCode({ pending = false, initialCode = "" }: { pending?: boolean; initialCode?: string }) {
  if (!pending) return <JoinForm initialCode={initialCode} />;
  pendingClient ??= new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  return (
    <ConvexProviderWithClerk client={pendingClient} useAuth={usePendingAuth}>
      <JoinForm initialCode={initialCode} />
    </ConvexProviderWithClerk>
  );
}

function JoinForm({ initialCode }: { initialCode: string }) {
  const redeem = useAction(api.inviteCodes.redeem);
  const clerk = useClerk();
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { orgId, joined, projects } = await redeem({ code });
      if (!joined && orgId === clerk.organization?.id) {
        showToast(
          projects
            ? `Ya eras parte del equipo. Recibiste acceso a ${projects} ${projects === 1 ? "proyecto" : "proyectos"}.`
            : "Ya eras parte de este equipo.",
        );
        setCode("");
        setBusy(false);
        return;
      }
      // The membership was created on the server: refresh the local copy before switching to it.
      await clerk.user?.reload();
      await clerk.setActive({ organization: orgId });
      window.location.assign(APP_HOME_PATH);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <section className="w-full card p-4" aria-labelledby="join-code-heading">
      <h2 id="join-code-heading" className="flex items-center gap-2 font-medium">
        <KeyRound className="size-4" /> ¿Tienes un código de invitación?
      </h2>
      <p className="mb-3 text-sm text-muted">
        Si no te llegó el correo de invitación, pide un código a un administrador del equipo.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="join-code">
          Código de invitación
        </label>
        <input
          id="join-code"
          className="input flex-1 font-mono tracking-wider uppercase"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="ABCDE-FGHJK"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={20}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "join-code-error" : undefined}
        />
        <button type="submit" className="btn-primary" disabled={busy || !code.trim()}>
          {busy ? "Uniéndote…" : "Unirme"}
        </button>
      </form>
      {error && (
        <p id="join-code-error" className="mt-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
