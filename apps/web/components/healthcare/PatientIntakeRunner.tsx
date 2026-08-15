"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { Notice, StatusBadge } from "@/components/ui/report-kit";
import { createClientOperationId } from "@/lib/client-operation-id";
import type { FormFieldDefinition } from "@dpf/types";

type IntakeForm = {
  formId: string;
  title: string;
  version: number;
  fields: FormFieldDefinition[];
  dataCategories: Record<string, string>;
  offlineCapable: boolean;
};

type PacketProjection = {
  packetId: string;
  status: string;
  version: number;
  dueAt: string | null;
  completionPercent: number;
  forms: IntakeForm[];
};

type SavedResponse = {
  responseId: string | null;
  version: number | null;
  status: string;
  answers: Record<string, unknown>;
  answeredLinkIds: string[];
};

type Grant = { token: string; expiresAt: string };

async function responseMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { message?: string; blockerCodes?: string[] } | null;
  if (body?.blockerCodes?.length) return "Some required forms or confirmations are still missing.";
  return body?.message ?? "We could not complete that request. Please try again.";
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function Field({
  definition,
  value,
  onChange,
  error,
}: {
  definition: FormFieldDefinition;
  value: unknown;
  onChange(value: unknown): void;
  error?: string;
}) {
  const id = `intake-field-${definition.key}`;
  const common = "mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)]";
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : undefined;

  if (["camera", "signature", "lookup", "location"].includes(definition.type)) {
    return (
      <Notice variant="info" title={`${definition.label} needs help from the office`}>
        This step is not available online yet. Save the other answers, then contact the office or complete it when you arrive.
      </Notice>
    );
  }

  let control: ReactNode;
  if (definition.type === "textarea") {
    control = <textarea id={id} className={common} rows={4} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy} />;
  } else if (definition.type === "select") {
    control = (
      <select id={id} className={common} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy}>
        <option value="">Choose an option</option>
        {(definition.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  } else if (definition.type === "multi-select") {
    const selected = Array.isArray(value) ? value.map(String) : [];
    control = (
      <select id={id} className={common} multiple value={selected} onChange={(event) => onChange(Array.from(event.target.selectedOptions, (option) => option.value))} aria-invalid={Boolean(error)} aria-describedby={describedBy}>
        {(definition.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  } else if (definition.type === "radio") {
    control = (
      <div className="mt-2 space-y-2">
        {(definition.options ?? []).map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm text-[var(--dpf-text)]">
            <input type="radio" name={id} value={option} checked={value === option} onChange={() => onChange(option)} />
            {option}
          </label>
        ))}
      </div>
    );
  } else if (definition.type === "checkbox" || definition.type === "toggle") {
    control = <input id={id} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} aria-invalid={Boolean(error)} aria-describedby={describedBy} />;
  } else {
    const type = definition.type === "number" ? "number" : definition.type === "date" ? "date" : "text";
    control = <input id={id} type={type} className={common} value={typeof value === "string" || typeof value === "number" ? value : ""} min={definition.min} max={definition.max} maxLength={definition.maxLength} onChange={(event) => onChange(type === "number" ? event.target.valueAsNumber : event.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy} />;
  }

  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-[var(--dpf-text)]">
        {definition.label}{definition.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {control}
      {error ? <p id={errorId} className="mt-1 text-sm text-[var(--dpf-danger)]">{error}</p> : null}
    </div>
  );
}

export function PatientIntakeRunner({ packetId }: { packetId: string }) {
  const [grant, setGrant] = useState<Grant | null>(null);
  const [packet, setPacket] = useState<PacketProjection | null>(null);
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [versions, setVersions] = useState<Record<string, number | null>>({});
  const [activeForm, setActiveForm] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(true);

  const loadPacket = useCallback(async (token: string) => {
    const packetResponse = await fetch(`/api/v1/healthcare/intake/${encodeURIComponent(packetId)}`, {
      headers: { "x-intake-resume-token": token }, cache: "no-store",
    });
    if (!packetResponse.ok) throw new Error(await responseMessage(packetResponse));
    const nextPacket = await packetResponse.json() as PacketProjection;
    const saved = await Promise.all(nextPacket.forms.map(async (form) => {
      const response = await fetch(`/api/v1/healthcare/intake/${encodeURIComponent(packetId)}/responses/${encodeURIComponent(form.formId)}`, {
        headers: { "x-intake-resume-token": token }, cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      return [form.formId, await response.json() as SavedResponse] as const;
    }));
    setPacket(nextPacket);
    setAnswers(Object.fromEntries(saved.map(([formId, response]) => [formId, response.answers])));
    setVersions(Object.fromEntries(saved.map(([formId, response]) => [formId, response.version])));
  }, [packetId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/v1/healthcare/intake/self/${encodeURIComponent(packetId)}/access-grants`, { method: "POST" });
        if (!response.ok) throw new Error(await responseMessage(response));
        const nextGrant = await response.json() as Grant;
        if (!active) return;
        setGrant(nextGrant);
        await loadPacket(nextGrant.token);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "We could not open these forms.");
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => { active = false; };
  }, [loadPacket, packetId]);

  const form = packet?.forms[activeForm] ?? null;
  const formAnswers = useMemo(() => form ? answers[form.formId] ?? {} : {}, [answers, form]);

  async function saveCurrent(): Promise<boolean> {
    if (!form || !grant) return false;
    const nextErrors = Object.fromEntries(form.fields
      .filter((field) => field.required && !["camera", "signature", "lookup", "location"].includes(field.type) && isEmpty(formAnswers[field.key]))
      .map((field) => [field.key, `${field.label} is required.`]));
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return false;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/healthcare/intake/${encodeURIComponent(packetId)}/responses/${encodeURIComponent(form.formId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-intake-resume-token": grant.token },
        body: JSON.stringify({
          idempotencyKey: createClientOperationId(), expectedVersion: versions[form.formId] ?? null,
          sourceMode: "patient-web", answers: formAnswers, dataCategories: form.dataCategories,
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const saved = await response.json() as SavedResponse;
      setVersions((current) => ({ ...current, [form.formId]: saved.version }));
      await loadPacket(grant.token);
      setMessage("Your answers were saved.");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not save your answers.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitAll() {
    if (!packet || !grant || !(await saveCurrent())) return;
    setBusy(true);
    try {
      const latestResponse = await fetch(`/api/v1/healthcare/intake/${encodeURIComponent(packetId)}`, {
        headers: { "x-intake-resume-token": grant.token }, cache: "no-store",
      });
      if (!latestResponse.ok) throw new Error(await responseMessage(latestResponse));
      const latest = await latestResponse.json() as PacketProjection;
      const response = await fetch(`/api/v1/healthcare/intake/${encodeURIComponent(packetId)}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-intake-resume-token": grant.token },
        body: JSON.stringify({ expectedVersion: latest.version, sourceMode: "patient-web" }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setMessage("Your forms were sent to the care team.");
      setPacket({ ...latest, status: "submitted", completionPercent: 100 });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not send your forms.");
    } finally {
      setBusy(false);
    }
  }

  if (busy && !packet) return <p className="text-sm text-[var(--dpf-muted)]" role="status">Opening your secure forms…</p>;
  if (!packet || !form) return <Notice variant="warn" title="Forms are unavailable">{message ?? "Contact the office for help."}</Notice>;
  if (packet.status === "submitted") return (
    <Notice variant="success" title="Forms sent">
      Your care team can now review them. <Link href="/portal/health">Back to My care</Link>
    </Notice>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs text-[var(--dpf-muted)]">Form {activeForm + 1} of {packet.forms.length}</p>
          <h1 className="text-2xl font-semibold text-[var(--dpf-text)]">{form.title}</h1>
        </div>
        <StatusBadge intent="info" label={`${packet.completionPercent}% complete`} variant="soft" />
      </div>
      <Notice variant="info" title="Your privacy">
        Only the care team handling this visit can review these answers. You can save and return before sending them.
      </Notice>
      <form className="space-y-5 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5" onSubmit={(event) => event.preventDefault()}>
        {form.fields.map((field) => (
          <Field key={field.key} definition={field} value={formAnswers[field.key]} error={errors[field.key]} onChange={(value) => setAnswers((current) => ({ ...current, [form.formId]: { ...(current[form.formId] ?? {}), [field.key]: value } }))} />
        ))}
      </form>
      {message ? <p className="text-sm text-[var(--dpf-muted)]" role="status">{message}</p> : null}
      <div className="flex flex-wrap justify-between gap-3">
        <button type="button" disabled={busy || activeForm === 0} onClick={() => setActiveForm((value) => value - 1)} className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-2 text-sm text-[var(--dpf-text)] disabled:opacity-50">Previous</button>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void saveCurrent()} className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-2 text-sm font-medium text-[var(--dpf-text)] disabled:opacity-50">Save</button>
          {activeForm < packet.forms.length - 1 ? (
            <button type="button" disabled={busy} onClick={() => void saveCurrent().then((saved) => { if (saved) setActiveForm((value) => value + 1); })} className="rounded-md bg-[var(--dpf-accent)] px-4 py-2 text-sm font-semibold text-[var(--dpf-bg)] disabled:opacity-50">Save and continue</button>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="rounded-md bg-[var(--dpf-accent)] px-4 py-2 text-sm font-semibold text-[var(--dpf-bg)] disabled:opacity-50">Review and send</button>
          )}
        </div>
      </div>
      {confirming ? (
        <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5" role="dialog" aria-labelledby="send-forms-title">
          <h2 id="send-forms-title" className="text-lg font-semibold text-[var(--dpf-text)]">Send these forms to your care team?</h2>
          <p className="mt-2 text-sm text-[var(--dpf-muted)]">You can still ask the office to correct information after you send it.</p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-2 text-sm text-[var(--dpf-text)]">Go back</button>
            <button type="button" disabled={busy} onClick={() => void submitAll()} className="rounded-md bg-[var(--dpf-accent)] px-4 py-2 text-sm font-semibold text-[var(--dpf-bg)] disabled:opacity-50">Send forms</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
