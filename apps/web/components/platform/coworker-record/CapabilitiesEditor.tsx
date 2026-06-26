"use client";

// EP-COWORKER-RT / WS2 — in-place grant/revoke of a coworker's tool grants and
// catalog skills, on the record's Capabilities tab. Mirrors the
// AgentModelRoutingCard idiom (inline styles, --dpf-* tokens only, optimistic
// router.refresh after a server action). Destructive removes go through
// confirmDialog (never window.confirm) per AGENTS.md / Dialog.tsx contract.
//
// Two id conventions flow through unchanged from the page (see
// lib/actions/coworker-grants.ts): tool grants act on the Agent.id cuid; skills
// act on the business agentId. Each control passes the value its action needs.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/ui/Dialog";
import {
  grantCoworkerTool,
  revokeCoworkerTool,
  grantCoworkerSkill,
  revokeCoworkerSkill,
} from "@/lib/actions/coworker-grants";

export type CatalogSkill = { skillId: string; name: string; category: string; riskBand: string };
export type AssignedSkill = { skillId: string; name: string; capability: string | null };

type Props = {
  /** Agent.id (cuid) — the key AgentToolGrant references. */
  agentCuid: string;
  /** Business agentId (e.g. "build-specialist") — the value SkillAssignment.agentId stores. */
  agentBusinessId: string;
  slugId: string | null;
  /** Currently-held tool-grant keys. */
  heldGrants: string[];
  /** The closed grant vocabulary (knownGrantKeys()). */
  allGrantKeys: string[];
  /** Catalog skills already assigned to this coworker. */
  assignedSkills: AssignedSkill[];
  /** Every active SkillDefinition in the catalog, for the add-select. */
  catalogSkills: CatalogSkill[];
  canWrite: boolean;
};

const chip = (held: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 10,
  padding: "2px 6px 2px 8px",
  borderRadius: 4,
  border: "1px solid var(--dpf-warning)",
  color: "var(--dpf-warning)",
  fontFamily: "monospace",
  whiteSpace: "nowrap",
});

const sel: React.CSSProperties = {
  padding: "5px 8px",
  fontSize: 12,
  borderRadius: 4,
  border: "1px solid var(--dpf-border)",
  background: "var(--dpf-surface-1)",
  color: "var(--dpf-text)",
  cursor: "pointer",
};

const addBtn = (disabled: boolean): React.CSSProperties => ({
  fontSize: 12,
  padding: "5px 12px",
  borderRadius: 4,
  cursor: disabled ? "default" : "pointer",
  border: "1px solid color-mix(in srgb, var(--dpf-accent) 40%, transparent)",
  background: disabled ? "transparent" : "color-mix(in srgb, var(--dpf-accent) 12%, transparent)",
  color: disabled ? "var(--dpf-muted)" : "var(--dpf-accent)",
  fontWeight: 500,
});

const removeBtn: React.CSSProperties = {
  appearance: "none",
  border: "none",
  background: "none",
  color: "var(--dpf-error)",
  cursor: "pointer",
  fontSize: 12,
  lineHeight: 1,
  padding: 0,
  fontFamily: "system-ui, sans-serif",
};

export function CapabilitiesEditor({
  agentCuid,
  agentBusinessId,
  slugId,
  heldGrants,
  allGrantKeys,
  assignedSkills,
  catalogSkills,
  canWrite,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [grantToAdd, setGrantToAdd] = useState("");
  const [skillToAdd, setSkillToAdd] = useState("");
  // Track the specific row being mutated so only it shows a busy state.
  const [busy, setBusy] = useState<string | null>(null);

  const heldSet = new Set(heldGrants);
  const grantOptions = allGrantKeys.filter((k) => !heldSet.has(k)).sort();
  const assignedSet = new Set(assignedSkills.map((s) => s.skillId));
  const skillOptions = catalogSkills.filter((s) => !assignedSet.has(s.skillId));

  function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setBusy(key);
    startTransition(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) {
        setError(res.error ?? "Action failed");
        return;
      }
      router.refresh();
    });
  }

  function onAddGrant() {
    if (!grantToAdd) return;
    const key = grantToAdd;
    setGrantToAdd("");
    run(`grant:${key}`, () => grantCoworkerTool(agentCuid, key, agentBusinessId, slugId));
  }

  async function onRemoveGrant(key: string) {
    const ok = await confirmDialog({
      title: "Revoke tool grant",
      message: `Remove "${key}" from this coworker? It will lose access to every tool that requires this grant.`,
      confirmLabel: "Revoke",
      tone: "danger",
    });
    if (!ok) return;
    run(`grant:${key}`, () => revokeCoworkerTool(agentCuid, key, agentBusinessId, slugId));
  }

  function onAddSkill() {
    if (!skillToAdd) return;
    const id = skillToAdd;
    setSkillToAdd("");
    run(`skill:${id}`, () => grantCoworkerSkill(agentBusinessId, id, slugId));
  }

  async function onRemoveSkill(skill: AssignedSkill) {
    const ok = await confirmDialog({
      title: "Unassign skill",
      message: `Unassign "${skill.name}" from this coworker?`,
      confirmLabel: "Unassign",
      tone: "danger",
    });
    if (!ok) return;
    run(`skill:${skill.skillId}`, () => revokeCoworkerSkill(agentBusinessId, skill.skillId, slugId));
  }

  return (
    <div>
      {error && (
        <div style={{ marginBottom: 10, fontSize: 11, color: "var(--dpf-error)" }}>{error}</div>
      )}

      {/* Catalog skills */}
      <div style={{ marginBottom: 18 }}>
        {assignedSkills.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8, marginBottom: canWrite ? 10 : 0 }}>
            {assignedSkills.map((skill) => (
              <div
                key={skill.skillId}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--dpf-border)",
                  background: "var(--dpf-surface)",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)" }}>{skill.name}</div>
                  <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginTop: 2, fontFamily: "monospace" }}>{skill.skillId}</div>
                  {skill.capability && (
                    <div style={{ fontSize: 10, color: "var(--dpf-accent)", marginTop: 3 }}>requires: {skill.capability}</div>
                  )}
                </div>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => onRemoveSkill(skill)}
                    disabled={pending && busy === `skill:${skill.skillId}`}
                    aria-label={`Unassign ${skill.name}`}
                    title="Unassign skill"
                    style={removeBtn}
                  >
                    {busy === `skill:${skill.skillId}` ? "…" : "✕"}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: "var(--dpf-muted)", fontStyle: "italic", padding: "8px 0" }}>
            No catalog skills assigned
          </div>
        )}

        {canWrite && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={skillToAdd}
              onChange={(e) => setSkillToAdd(e.target.value)}
              disabled={pending || skillOptions.length === 0}
              style={sel}
            >
              <option value="">
                {skillOptions.length === 0 ? "All catalog skills assigned" : "Add a skill…"}
              </option>
              {skillOptions.map((s) => (
                <option key={s.skillId} value={s.skillId}>
                  {s.name} ({s.category})
                </option>
              ))}
            </select>
            <button type="button" onClick={onAddSkill} disabled={pending || !skillToAdd} style={addBtn(pending || !skillToAdd)}>
              {busy?.startsWith("skill:") && pending ? "Adding…" : "Add skill"}
            </button>
          </div>
        )}
      </div>

      {/* Tool grants */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 8 }}>
          Tool grants (least privilege)
        </div>
        {heldGrants.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: canWrite ? 10 : 0 }}>
            {[...heldGrants].sort().map((key) => (
              <span key={key} style={chip(true)}>
                {key}
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => onRemoveGrant(key)}
                    disabled={pending && busy === `grant:${key}`}
                    aria-label={`Revoke ${key}`}
                    title="Revoke grant"
                    style={removeBtn}
                  >
                    {busy === `grant:${key}` ? "…" : "✕"}
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: "var(--dpf-muted)", fontStyle: "italic", padding: "8px 0" }}>
            No tool grants assigned
          </div>
        )}

        {canWrite && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={grantToAdd}
              onChange={(e) => setGrantToAdd(e.target.value)}
              disabled={pending || grantOptions.length === 0}
              style={sel}
            >
              <option value="">
                {grantOptions.length === 0 ? "All grants held" : "Add a tool grant…"}
              </option>
              {grantOptions.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <button type="button" onClick={onAddGrant} disabled={pending || !grantToAdd} style={addBtn(pending || !grantToAdd)}>
              {busy?.startsWith("grant:") && pending ? "Adding…" : "Add grant"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
