"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { Check, Copy } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Skeleton } from "@/components/PageHeader";
import { showToast } from "@/components/ToastViewport";
import { errorMessage } from "@/lib/errors";

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => showToast("No se pudo copiar."),
    );
  return (
    <div className="flex items-start gap-2 rounded-md bg-surface-2 p-2">
      <code className="min-w-0 flex-1 text-xs break-all whitespace-pre-wrap">{value}</code>
      <button type="button" className="btn-ghost shrink-0 px-2 py-1 text-xs" onClick={copy} aria-label={label}>
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

/** Personal access tokens for the MCP endpoint, so Claude can add tasks for the signed-in member. */
export function ClaudeMcpSettings() {
  const data = useQuery(api.mcp.listTokens, {});
  const create = useAction(api.mcp.createToken);
  const revoke = useMutation(api.mcp.revokeToken);
  const [name, setName] = useState("Claude");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  if (data === undefined) return <Skeleton className="h-24" />;
  if (data === null) return null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      setToken(await create({ name: name.trim() }));
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const onRevoke = (tokenId: Id<"apiTokens">, tokenName: string) => {
    if (!confirm(`¿Revocar el token «${tokenName}»? Las apps que lo usen dejarán de funcionar.`)) return;
    revoke({ tokenId }).then(
      () => showToast("Token revocado."),
      (error) => showToast(errorMessage(error)),
    );
  };
  const endpoint = data.endpoint ?? "https://<tu-deployment>.convex.site/mcp";
  const command = `claude mcp add --transport http lcftodos ${endpoint} --header "Authorization: Bearer ${token ?? "<token>"}"`;

  return (
    <section aria-labelledby="claude-heading">
      <h2 id="claude-heading" className="mb-2 font-medium">
        Claude (MCP)
      </h2>
      <div className="space-y-3 card px-4 py-3">
        <p className="text-sm text-muted">
          Conecta Claude a LCF Todos para crear y consultar tareas desde el chat. Crea un token personal: Claude actuará
          como tú y solo verá lo que tú puedes ver.
        </p>
        <form onSubmit={onSubmit} className="flex flex-wrap gap-2">
          <label htmlFor="token-name" className="sr-only">
            Nombre del token
          </label>
          <input
            id="token-name"
            className="input min-w-0 flex-1"
            maxLength={60}
            autoComplete="off"
            placeholder="Nombre, p. ej. Claude en mi portátil"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={busy || !name.trim()}>
            Crear token
          </button>
        </form>
        {token && (
          <div className="space-y-2" role="status">
            <p className="text-sm font-medium">Copia el token ahora: no se volverá a mostrar.</p>
            <CopyBlock label="Copiar token" value={token} />
          </div>
        )}
        <div className="space-y-2">
          <p className="text-sm">Añádelo a Claude Code con:</p>
          <CopyBlock label="Copiar comando" value={command} />
          <p className="text-xs text-muted">
            En otras apps compatibles con MCP, usa la URL <code>{endpoint}</code> y la cabecera{" "}
            <code>Authorization: Bearer &lt;token&gt;</code>.
          </p>
        </div>
        {data.tokens.length > 0 && (
          <ul className="divide-y divide-line">
            {data.tokens.map((t) => (
              <li key={t._id} className="flex items-center gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.name}</p>
                  <p className="text-xs text-muted">
                    <code>{t.prefix}…</code> · creado el {formatDate(t.createdAt)} ·{" "}
                    {t.lastUsedAt ? `usado el ${formatDate(t.lastUsedAt)}` : "sin usar"}
                  </p>
                </div>
                <button type="button" className="btn-outline shrink-0 text-xs" onClick={() => onRevoke(t._id, t.name)}>
                  Revocar<span className="sr-only">: {t.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
