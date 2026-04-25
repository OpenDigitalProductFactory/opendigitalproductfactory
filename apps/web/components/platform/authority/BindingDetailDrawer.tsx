"use client";

import { useMemo, useState } from "react";

import { BindingEvidencePanel } from "./BindingEvidencePanel";

type BindingDetailDrawerProps = {
  binding: {
    bindingId: string;
    name: string;
    scopeType: string;
    status: string;
    resourceType: string;
    resourceRef: string;
    approvalMode: string;
    sensitivityCeiling: string | null;
    appliedAgent: {
      agentId: string;
      name: string;
      governanceProfile: {
        capabilityClass?: { name: string } | null;
        directivePolicyClass?: { name: string } | null;
      } | null;
      toolGrants: Array<{ grantKey: string }>;
    } | null;
    subjects: Array<{
      id: string;
      subjectType: string;
      subjectRef: string;
      relation: string;
    }>;
    grants: Array<{
      id: string;
      grantKey: string;
      mode: string;
      rationale: string | null;
    }>;
  };
  evidence: Array<{
    id: string;
    decisionId: string;
    decision: string;
    actionKey: string;
    routeContext: string | null;
    createdAt: Date;
  }>;
};

type EditableSubject = {
  subjectType: string;
  subjectRef: string;
  relation: string;
};

type EditableGrant = {
  grantKey: string;
  mode: string;
  rationale: string;
};

type BindingPatchDraft = {
  name: string;
  status: string;
  approvalMode: string;
  sensitivityCeiling: string;
  subjects: EditableSubject[];
  grants: EditableGrant[];
  intrinsicGrantKeys: string[];
};

function sectionCard(title: string, children: React.ReactNode) {
  return (
    <section className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function mapInitialSubjects(subjects: BindingDetailDrawerProps["binding"]["subjects"]): EditableSubject[] {
  return subjects.map((subject) => ({
    subjectType: subject.subjectType,
    subjectRef: subject.subjectRef,
    relation: subject.relation,
  }));
}

function mapInitialGrants(grants: BindingDetailDrawerProps["binding"]["grants"]): EditableGrant[] {
  return grants.map((grant) => ({
    grantKey: grant.grantKey,
    mode: grant.mode,
    rationale: grant.rationale ?? "",
  }));
}

export function prepareBindingPatchPayload(draft: BindingPatchDraft) {
  const intrinsicGrantKeys = new Set(draft.intrinsicGrantKeys);

  return {
    name: draft.name,
    status: draft.status,
    approvalMode: draft.approvalMode,
    sensitivityCeiling: draft.sensitivityCeiling.trim() ? draft.sensitivityCeiling.trim() : null,
    subjects: draft.subjects.filter((subject) => subject.subjectRef.trim()),
    grants: draft.grants
      .filter((grant) => grant.grantKey.trim())
      .filter((grant) => intrinsicGrantKeys.has(grant.grantKey.trim()))
      .map((grant) => ({
        grantKey: grant.grantKey.trim(),
        mode: grant.mode,
        rationale: grant.rationale.trim() || null,
      })),
  };
}

export function BindingDetailDrawer({ binding, evidence }: BindingDetailDrawerProps) {
  const [name, setName] = useState(binding.name);
  const [status, setStatus] = useState(binding.status);
  const [approvalMode, setApprovalMode] = useState(binding.approvalMode);
  const [sensitivityCeiling, setSensitivityCeiling] = useState(binding.sensitivityCeiling ?? "");
  const [subjects, setSubjects] = useState<EditableSubject[]>(() => mapInitialSubjects(binding.subjects));
  const [grants, setGrants] = useState<EditableGrant[]>(() => mapInitialGrants(binding.grants));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const intrinsicGrantLabel = useMemo(
    () => binding.appliedAgent?.toolGrants.map((grant) => grant.grantKey).join(", ") || "None",
    [binding.appliedAgent],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/platform/authority-bindings/${binding.bindingId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          prepareBindingPatchPayload({
            name,
            status,
            approvalMode,
            sensitivityCeiling,
            subjects,
            grants,
            intrinsicGrantKeys: binding.appliedAgent?.toolGrants.map((grant) => grant.grantKey) ?? [],
          }),
        ),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to update authority binding.");
      }

      setMessage("Binding changes saved.");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Failed to update authority binding.");
    } finally {
      setSaving(false);
    }
  }

  function updateSubject(index: number, field: keyof EditableSubject, value: string) {
    setSubjects((current) => current.map((subject, itemIndex) => (itemIndex === index ? { ...subject, [field]: value } : subject)));
  }

  function updateGrant(index: number, field: keyof EditableGrant, value: string) {
    setGrants((current) => current.map((grant, itemIndex) => (itemIndex === index ? { ...grant, [field]: value } : grant)));
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">{binding.bindingId}</div>
            <h1 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">{binding.name}</h1>
            <p className="mt-1 text-sm text-[var(--dpf-muted)]">
              {binding.resourceType} {binding.resourceRef} · {binding.scopeType}
            </p>
          </div>
          <div className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1 text-xs text-[var(--dpf-text)]">
            {binding.approvalMode}
          </div>
        </div>
      </div>

      {sectionCard(
        "Summary",
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[var(--dpf-text)]">
            <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]"
            />
          </label>
          <label className="block text-sm text-[var(--dpf-text)]">
            <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]"
            >
              <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="draft">draft</option>
              <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="active">active</option>
              <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="disabled">disabled</option>
              <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="retired">retired</option>
            </select>
          </label>
          <label className="block text-sm text-[var(--dpf-text)]">
            <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Approval mode</span>
            <select
              value={approvalMode}
              onChange={(event) => setApprovalMode(event.target.value)}
              className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]"
            >
              <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="none">none</option>
              <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="proposal-required">proposal-required</option>
              <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="human-required">human-required</option>
            </select>
          </label>
          <label className="block text-sm text-[var(--dpf-text)]">
            <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Sensitivity ceiling</span>
            <input
              value={sensitivityCeiling}
              onChange={(event) => setSensitivityCeiling(event.target.value)}
              placeholder="Not set"
              className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]"
            />
          </label>
          <div className="text-sm text-[var(--dpf-text)]">
            <div className="mb-1 text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Resource</div>
            <div>{binding.resourceRef}</div>
          </div>
          <div className="text-sm text-[var(--dpf-text)]">
            <div className="mb-1 text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Applied coworker</div>
            <div>{binding.appliedAgent?.name ?? "Unassigned"}</div>
          </div>
        </div>,
      )}

      {sectionCard(
        "Subjects",
        <div className="space-y-3">
          {subjects.length === 0 ? <div className="text-sm text-[var(--dpf-muted)]">No subjects configured yet.</div> : null}
          {subjects.map((subject, index) => (
            <div key={`${subject.subjectType}:${subject.subjectRef}:${index}`} className="grid gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 md:grid-cols-3">
              <label className="block text-sm text-[var(--dpf-text)]">
                <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Subject type</span>
                <input
                  value={subject.subjectType}
                  onChange={(event) => updateSubject(index, "subjectType", event.target.value)}
                  className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)]"
                />
              </label>
              <label className="block text-sm text-[var(--dpf-text)]">
                <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Subject ref</span>
                <input
                  value={subject.subjectRef}
                  onChange={(event) => updateSubject(index, "subjectRef", event.target.value)}
                  className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)]"
                />
              </label>
              <label className="block text-sm text-[var(--dpf-text)]">
                <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Relation</span>
                <select
                  value={subject.relation}
                  onChange={(event) => updateSubject(index, "relation", event.target.value)}
                  className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)]"
                >
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="allowed">allowed</option>
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="required">required</option>
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="owner">owner</option>
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="observer">observer</option>
                </select>
              </label>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setSubjects((current) => [...current, { subjectType: "platform-role", subjectRef: "", relation: "allowed" }])}
            className="rounded-md border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-text)]"
          >
            Add subject
          </button>
        </div>,
      )}

      {sectionCard(
        "Coworker application",
        <div className="space-y-3 text-sm text-[var(--dpf-text)]">
          <div>
            <div className="font-medium">{binding.appliedAgent?.name ?? "No coworker assigned"}</div>
            {binding.appliedAgent ? (
              <div className="text-[var(--dpf-muted)]">
                {binding.appliedAgent.agentId}
                {binding.appliedAgent.governanceProfile?.capabilityClass?.name
                  ? ` · ${binding.appliedAgent.governanceProfile.capabilityClass.name}`
                  : ""}
                {binding.appliedAgent.governanceProfile?.directivePolicyClass?.name
                  ? ` · ${binding.appliedAgent.governanceProfile.directivePolicyClass.name}`
                  : ""}
              </div>
            ) : null}
          </div>
          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-muted)]">
            Intrinsic grants: {intrinsicGrantLabel}
          </div>
          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs text-[var(--dpf-muted)]">
            Binding grants can only narrow intrinsic coworker grants. Use <code>deny</code> or <code>require-approval</code> for contextual controls.
          </div>
          {grants.length === 0 ? <div className="text-sm text-[var(--dpf-muted)]">No contextual grant narrowing configured yet.</div> : null}
          {grants.map((grant, index) => (
            <div key={`${grant.grantKey}:${index}`} className="grid gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 md:grid-cols-[1.2fr_0.8fr_1.5fr]">
              <label className="block text-sm text-[var(--dpf-text)]">
                <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Grant key</span>
                <input
                  value={grant.grantKey}
                  onChange={(event) => updateGrant(index, "grantKey", event.target.value)}
                  className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)]"
                />
              </label>
              <label className="block text-sm text-[var(--dpf-text)]">
                <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Mode</span>
                <select
                  value={grant.mode}
                  onChange={(event) => updateGrant(index, "mode", event.target.value)}
                  className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)]"
                >
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="deny">deny</option>
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="require-approval">require-approval</option>
                  <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="allow">allow</option>
                </select>
              </label>
              <label className="block text-sm text-[var(--dpf-text)]">
                <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Rationale</span>
                <input
                  value={grant.rationale}
                  onChange={(event) => updateGrant(index, "rationale", event.target.value)}
                  className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)]"
                />
              </label>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setGrants((current) => [...current, { grantKey: "", mode: "require-approval", rationale: "" }])}
            className="rounded-md border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-text)]"
          >
            Add contextual grant
          </button>
        </div>,
      )}

      {sectionCard("Evidence", <BindingEvidencePanel evidence={evidence} />)}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="text-sm text-[var(--dpf-muted)]">
          {error ? <span className="text-[var(--dpf-danger,#dc2626)]">{error}</span> : message ?? "Adjust the applied policy from either admin entry point."}
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-[var(--dpf-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </form>
  );
}
