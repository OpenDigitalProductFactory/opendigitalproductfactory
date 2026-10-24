"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/form/SelectField";
import { getWorkroomAssistantChoices, saveWorkroomAssistantInvitation } from "@/lib/actions/workroom-assistant-invitation";
import type { WorkroomAssistantChoice } from "@/lib/work-management/workroom-assistant-invitation";

export function WorkroomInviteAssistant({ workroomId }: { workroomId: string }) {
  return <AssistantAccess key={workroomId} workroomId={workroomId} />;
}

function AssistantAccess({ workroomId }: { workroomId: string }) {
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<WorkroomAssistantChoice[] | null>(null);
  const [agentId, setAgentId] = useState("");
  const [role, setRole] = useState<"observer" | "contributor">("observer");
  const [message, setMessage] = useState("");
  async function show() {
    if (open) { setOpen(false); return; }
    setOpen(true); setBusy(true); setMessage(""); setChoices(null);
    try {
      const result = await getWorkroomAssistantChoices(workroomId);
      if (!result.ok) { setMessage(result.error); return; }
      setChoices(result.data); setAgentId(result.data[0]?.agentId ?? ""); setRole(result.data[0]?.role ?? "observer");
    } catch { setMessage("Could not load access. Try again."); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const result = await saveWorkroomAssistantInvitation({ workroomId, agentId, role });
      if (!result.ok) { setMessage(result.error); return; }
      setChoices((current) => current?.map((choice) => choice.agentId === agentId ? { ...choice, role } : choice) ?? null);
      setMessage("Saved for this room. Continue without signing in again."); router.refresh();
    } catch { setMessage("Access was not saved. Try again."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3">
    <Button variant="secondary" disabled={busy} aria-expanded={open} aria-controls={id} onClick={show}>Assistant access</Button>
    {open ? <div id={id} className="mt-3 space-y-3" aria-busy={busy}>
      {choices?.length ? <form onSubmit={save} className="space-y-3">
        <p className="text-sm text-[var(--dpf-muted)]">Applies to this room. Your permissions and data access still apply.</p>
        <SelectField name={`${id}-assistant`} label="Assistant" value={agentId} disabled={busy} onValueChange={(value) => { setAgentId(value); setRole(choices.find((choice) => choice.agentId === value)?.role ?? "observer"); setMessage(""); }}
          options={choices.map((choice) => ({ value: choice.agentId,
            label: choices.filter((other) => other.name === choice.name).length > 1 ? `${choice.name} (${choice.agentId})` : choice.name }))} />
        <SelectField name={`${id}-access`} label="Access" value={role} disabled={busy} onValueChange={(value) => setRole(value === "contributor" ? "contributor" : "observer")}
          options={[{ value: "observer", label: "Read only" }, { value: "contributor", label: "Contribute" }]} />
        <Button type="submit" disabled={busy || !agentId}>Save room access</Button>
      </form> : choices ? <p>No approved assistant connections are available in your account.</p> : null}
      <p role="status" className="text-sm text-[var(--dpf-muted)]">{busy ? "Loading…" : message}</p>
    </div> : null}
  </div>;
}
