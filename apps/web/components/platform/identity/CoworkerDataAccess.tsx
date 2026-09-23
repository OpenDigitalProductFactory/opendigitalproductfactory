"use client";

import { useId, useState, useTransition } from "react";
import { PRINCIPAL_SENSITIVITIES } from "@dpf/db/principal-sensitivity";
import { updateCoworkerDataAccess } from "@/lib/actions/coworker-data-access";
import { Button } from "@/components/ui/Button";
import { TextareaField } from "@/components/ui/form/TextareaField";

export function CoworkerDataAccess({ agentId, current, allowed }: {
  agentId: string; current: string[]; allowed: string[];
}) {
  const id = useId();
  const [saved, setSaved] = useState(current);
  const [selected, setSelected] = useState(current);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-4 text-sm text-[var(--dpf-text)]">
      <p>Data access: {saved.join(", ")}</p>
      {allowed.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[var(--dpf-accent)]">Change data access</summary>
          <form className="mt-3 space-y-3" onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await updateCoworkerDataAccess({ agentId, expected: saved, levels: selected, reason });
              if (result.ok) { setSaved(result.data.levels); setSelected(result.data.levels); setReason(""); setMessage("Saved. Existing connections use this access without signing in again."); }
              else setMessage(result.error);
            });
          }}>
            <p className="text-[var(--dpf-muted)]">Applies to this coworker across connections. Each user still needs permission and workroom access.</p>
            <fieldset disabled={pending} className="space-y-2">
              <legend>Allowed information</legend>
              {PRINCIPAL_SENSITIVITIES.map((level) => (
                <label key={level} className="flex items-center gap-2">
                  <input type="checkbox" checked={selected.includes(level)} disabled={!allowed.includes(level)} onChange={(event) => {
                    setSelected(event.target.checked ? [...selected, level] : selected.filter((value) => value !== level));
                  }} />
                  <span className="capitalize">{level}</span>
                  {!allowed.includes(level) ? <span className="text-[var(--dpf-muted)]">Outside your access</span> : null}
                </label>
              ))}
            </fieldset>
            <TextareaField name={`${id}-reason`} label="Reason for the change" value={reason} onValueChange={setReason}
              required minLength={10} maxLength={1000} disabled={pending} />
            <Button type="submit" disabled={pending || !selected.length || reason.trim().length < 10}>
              {pending ? "Saving…" : "Save data access"}
            </Button>
          </form>
        </details>
      ) : <p className="mt-1 text-[var(--dpf-muted)]">An administrator can change the information this coworker may use.</p>}
      <p role="status" className="mt-2">{message}</p>
    </div>
  );
}
