"use client";

import { useState, useTransition } from "react";
import { saveCooConversationalName } from "@/lib/actions/coo-conversational-name";
import { COO_NAME_MAX_LENGTH, COO_NAME_SUGGESTION_GROUPS } from "@/lib/coworker-presentation/coo-name";

export function CooConversationalNameCard({ initialName, canWrite }: { initialName: string | null; canWrite: boolean }) {
  const [name, setName] = useState(initialName ?? "");
  const [savedName, setSavedName] = useState(initialName);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(value: string | null) {
    startTransition(async () => {
      setMessage(null);
      const result = await saveCooConversationalName({ name: value });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setName(result.value ?? "");
      setSavedName(result.value);
      setMessage(result.value ? "Conversational name saved." : "The standing coworker will be shown as COO.");
    });
  }

  return (
    <section aria-labelledby="coo-conversational-name-heading" style={{ marginBottom: 20, padding: 14, border: "1px solid var(--dpf-border)", borderRadius: 10, background: "var(--dpf-surface-1)" }}>
      <h2 id="coo-conversational-name-heading" style={{ margin: 0, fontSize: 13, color: "var(--dpf-text)" }}>Conversational name</h2>
      <p style={{ margin: "5px 0 10px", fontSize: 11, lineHeight: 1.5, color: "var(--dpf-muted)", maxWidth: 760 }}>
        {savedName ? `Presented as ${savedName} · AI COO.` : "Presented as COO."} This organization-visible preference does not change the canonical COO identity, permissions, authority, audit history, or owner accountability.
      </p>
      {canWrite && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }} aria-label="Suggested COO names">
            {COO_NAME_SUGGESTION_GROUPS.flatMap((group) => group.names.map((suggestion) => (
              <button key={suggestion} type="button" disabled={pending} onClick={() => setName(suggestion)} style={{ border: "1px solid var(--dpf-border)", borderRadius: 999, padding: "4px 9px", fontSize: 10, color: "var(--dpf-text)", background: "transparent" }}>{suggestion}</button>
            )))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <label htmlFor="coo-name-settings" className="sr-only">Conversational name</label>
            <input id="coo-name-settings" value={name} maxLength={COO_NAME_MAX_LENGTH} disabled={pending} onChange={(event) => setName(event.target.value)} style={{ minWidth: 240, flex: "1 1 280px", border: "1px solid var(--dpf-border)", borderRadius: 6, padding: "7px 9px", fontSize: 12, color: "var(--dpf-text)", background: "var(--dpf-bg)" }} />
            <button type="button" disabled={pending} onClick={() => save(name)} style={{ border: "1px solid var(--dpf-accent)", borderRadius: 6, padding: "7px 12px", fontSize: 11, color: "var(--dpf-accent)", background: "color-mix(in srgb, var(--dpf-accent) 12%, transparent)" }}>{pending ? "Saving…" : "Save"}</button>
            <button type="button" disabled={pending} onClick={() => save(null)} style={{ border: "1px solid var(--dpf-border)", borderRadius: 6, padding: "7px 12px", fontSize: 11, color: "var(--dpf-muted)", background: "transparent" }}>Use COO</button>
          </div>
        </>
      )}
      {message && <p role="status" style={{ margin: "8px 0 0", fontSize: 11, color: message.includes("saved") || message.includes("shown") ? "var(--dpf-success)" : "var(--dpf-error)" }}>{message}</p>}
    </section>
  );
}
