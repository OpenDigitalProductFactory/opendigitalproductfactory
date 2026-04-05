"use client";

import { useState, useTransition } from "react";
import {
  createCustomBusinessModel,
  updateCustomBusinessModel,
  cloneBusinessModel,
  deprecateBusinessModel,
  retireBusinessModel,
} from "@/lib/actions/business-model";

// ─── Types ────────────────────────────────────────────────────────────────────

type Model = {
  id: string;
  modelId: string;
  name: string;
  description: string | null;
  isBuiltIn: boolean;
  status: string;
  _count: { roles: number; products: number };
};

type RoleDraft = {
  name: string;
  authorityDomain: string;
  escalatesTo: string;
  hitlTierDefault: number;
};

type View = "list" | "create" | { cloneId: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const PLATFORM_ROLES = [
  { id: "HR-000", name: "CDIO / Executive Sponsor" },
  { id: "HR-100", name: "Portfolio Manager" },
  { id: "HR-200", name: "Digital Product Manager" },
  { id: "HR-300", name: "Enterprise Architect" },
  { id: "HR-400", name: "ITFM Director" },
  { id: "HR-500", name: "Operations Manager" },
];

const STATUS_COLOUR: Record<string, string> = {
  active: "var(--dpf-success)",
  deprecated: "var(--dpf-warning)",
  retired: "var(--dpf-muted)",
};

// ─── Shared input styles ──────────────────────────────────────────────────────

const inputBase: React.CSSProperties = {
  background: "var(--dpf-surface-2)",
  border: "1px solid var(--dpf-border)",
  borderRadius: 4,
  color: "var(--dpf-text)",
  fontSize: 12,
  padding: "4px 8px",
  width: "100%",
  boxSizing: "border-box",
};

// ─── Create / Clone form ──────────────────────────────────────────────────────

function emptyRole(): RoleDraft {
  return { name: "", authorityDomain: "", escalatesTo: "HR-200", hitlTierDefault: 2 };
}

function CreateForm({
  cloneSource,
  onDone,
}: {
  cloneSource: string | null;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [roles, setRoles] = useState<RoleDraft[]>([emptyRole()]);
  const [error, setError] = useState<string | null>(null);

  function addRole() {
    if (roles.length >= 20) return;
    setRoles((r) => [...r, emptyRole()]);
  }

  function removeRole(i: number) {
    setRoles((r) => r.filter((_, idx) => idx !== i));
  }

  function updateRole(i: number, field: keyof RoleDraft, value: string | number) {
    setRoles((r) => r.map((role, idx) => (idx === i ? { ...role, [field]: value } : role)));
  }

  function handleSubmit() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    const validRoles = roles.filter((r) => r.name.trim());
    if (!cloneSource && validRoles.length === 0) {
      setError("At least one role with a name is required");
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        if (cloneSource) {
          await cloneBusinessModel(cloneSource, name.trim());
        } else {
          await createCustomBusinessModel(
            name.trim(),
            description.trim() || null,
            validRoles.map((r) => ({
              name: r.name,
              authorityDomain: r.authorityDomain || undefined,
              escalatesTo: r.escalatesTo,
              hitlTierDefault: r.hitlTierDefault,
            })),
          );
        }
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    });
  }

  return (
    <div
      style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h3
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--dpf-text)",
          margin: "0 0 12px",
        }}
      >
        {cloneSource ? "Clone Business Model" : "Create Custom Business Model"}
      </h3>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <label
            style={{
              fontSize: 11,
              color: "var(--dpf-muted)",
              display: "block",
              marginBottom: 3,
            }}
          >
            Name *
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputBase}
            placeholder="e.g. Subscription Commerce"
          />
        </div>

        {!cloneSource && (
          <>
            <div>
              <label
                style={{
                  fontSize: 11,
                  color: "var(--dpf-muted)",
                  display: "block",
                  marginBottom: 3,
                }}
              >
                Description
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={inputBase}
                placeholder="Optional description"
              />
            </div>

            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <label style={{ fontSize: 11, color: "var(--dpf-muted)" }}>
                  Roles ({roles.length}/20)
                </label>
                <button
                  type="button"
                  onClick={addRole}
                  disabled={roles.length >= 20}
                  style={{
                    fontSize: 10,
                    background: "none",
                    border: "1px solid var(--dpf-border)",
                    borderRadius: 4,
                    color: "var(--dpf-muted)",
                    cursor: "pointer",
                    padding: "2px 8px",
                  }}
                >
                  + Add role
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {roles.map((role, i) => (
                  <div
                    key={i}
                    style={{
                      background: "var(--dpf-surface-2)",
                      border: "1px solid var(--dpf-border)",
                      borderRadius: 6,
                      padding: "8px 10px",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 8,
                        marginBottom: 6,
                      }}
                    >
                      <div>
                        <label
                          style={{
                            fontSize: 10,
                            color: "var(--dpf-muted)",
                            display: "block",
                            marginBottom: 2,
                          }}
                        >
                          Role name *
                        </label>
                        <input
                          value={role.name}
                          onChange={(e) => updateRole(i, "name", e.target.value)}
                          style={inputBase}
                          placeholder="e.g. Customer Success Manager"
                        />
                      </div>
                      <div>
                        <label
                          style={{
                            fontSize: 10,
                            color: "var(--dpf-muted)",
                            display: "block",
                            marginBottom: 2,
                          }}
                        >
                          Authority domain
                        </label>
                        <input
                          value={role.authorityDomain}
                          onChange={(e) => updateRole(i, "authorityDomain", e.target.value)}
                          style={inputBase}
                          placeholder="e.g. Retention, renewal"
                        />
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr auto",
                        gap: 8,
                        alignItems: "end",
                      }}
                    >
                      <div>
                        <label
                          style={{
                            fontSize: 10,
                            color: "var(--dpf-muted)",
                            display: "block",
                            marginBottom: 2,
                          }}
                        >
                          Escalates to
                        </label>
                        <select
                          value={role.escalatesTo}
                          onChange={(e) => updateRole(i, "escalatesTo", e.target.value)}
                          style={{ ...inputBase, cursor: "pointer" }}
                        >
                          {PLATFORM_ROLES.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.id} — {r.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label
                          style={{
                            fontSize: 10,
                            color: "var(--dpf-muted)",
                            display: "block",
                            marginBottom: 2,
                          }}
                        >
                          HITL tier
                        </label>
                        <select
                          value={role.hitlTierDefault}
                          onChange={(e) =>
                            updateRole(i, "hitlTierDefault", Number(e.target.value))
                          }
                          style={{ ...inputBase, cursor: "pointer" }}
                        >
                          <option value={0}>0 — Blocked</option>
                          <option value={1}>1 — Approve before</option>
                          <option value={2}>2 — Review after</option>
                          <option value={3}>3 — Log only</option>
                        </select>
                      </div>

                      {roles.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeRole(i)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--dpf-muted)",
                            cursor: "pointer",
                            fontSize: 16,
                            lineHeight: 1,
                            padding: "2px 4px",
                            alignSelf: "center",
                          }}
                          title="Remove role"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {cloneSource && (
          <p style={{ fontSize: 11, color: "var(--dpf-muted)", margin: 0 }}>
            All roles from the source model will be copied into the new custom model.
          </p>
        )}

        {error && (
          <p style={{ fontSize: 11, color: "var(--dpf-error)", margin: 0 }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onDone}
            disabled={isPending}
            style={{
              fontSize: 11,
              background: "none",
              border: "1px solid var(--dpf-border)",
              borderRadius: 5,
              color: "var(--dpf-muted)",
              cursor: "pointer",
              padding: "5px 12px",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            style={{
              fontSize: 11,
              background: "var(--dpf-accent)",
              border: "none",
              borderRadius: 5,
              color: "#fff",
              cursor: "pointer",
              padding: "5px 14px",
              opacity: isPending ? 0.7 : 1,
            }}
          >
            {isPending ? "Saving…" : cloneSource ? "Clone" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Model card ───────────────────────────────────────────────────────────────

function ModelCard({
  model,
  onClone,
}: {
  model: Model;
  onClone: (modelId: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(model.name);
  const [editDesc, setEditDesc] = useState(model.description ?? "");
  const [error, setError] = useState<string | null>(null);

  const statusColour = STATUS_COLOUR[model.status] ?? "var(--dpf-muted)";
  const leftBorder = model.isBuiltIn ? "var(--dpf-accent)" : statusColour;

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        await updateCustomBusinessModel(model.modelId, editName, editDesc || null);
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    });
  }

  function handleDeprecate() {
    if (!confirm(`Deprecate "${model.name}"? No new assignments will be allowed.`)) return;
    startTransition(async () => {
      try {
        await deprecateBusinessModel(model.modelId);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Unknown error");
      }
    });
  }

  function handleRetire() {
    if (!confirm(`Retire "${model.name}"? This is irreversible and requires no active assignments.`)) return;
    startTransition(async () => {
      try {
        await retireBusinessModel(model.modelId);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Unknown error");
      }
    });
  }

  const btnBase: React.CSSProperties = {
    fontSize: 10,
    background: "none",
    border: "1px solid var(--dpf-border)",
    borderRadius: 4,
    color: "var(--dpf-muted)",
    cursor: "pointer",
    padding: "3px 8px",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderLeft: `3px solid ${leftBorder}`,
        borderRadius: 8,
        padding: "12px 14px",
        opacity: isPending ? 0.7 : 1,
      }}
    >
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            style={inputBase}
          />
          <input
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            style={inputBase}
            placeholder="Description (optional)"
          />
          {error && (
            <p style={{ fontSize: 11, color: "var(--dpf-error)", margin: 0 }}>{error}</p>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              style={{
                fontSize: 10,
                background: "var(--dpf-accent)",
                border: "none",
                borderRadius: 4,
                color: "#fff",
                cursor: "pointer",
                padding: "3px 10px",
              }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setEditName(model.name);
                setEditDesc(model.description ?? "");
                setError(null);
              }}
              style={btnBase}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 2,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)" }}
              >
                {model.name}
              </span>
              {model.isBuiltIn && (
                <span
                  style={{
                    fontSize: 9,
                    color: "var(--dpf-accent)",
                    background: "color-mix(in srgb, var(--dpf-accent) 13%, transparent)",
                    borderRadius: 3,
                    padding: "1px 5px",
                  }}
                >
                  built-in
                </span>
              )}
              {!model.isBuiltIn && model.status !== "active" && (
                <span
                  style={{
                    fontSize: 9,
                    color: statusColour,
                    background: `color-mix(in srgb, ${statusColour} 13%, transparent)`,
                    borderRadius: 3,
                    padding: "1px 5px",
                  }}
                >
                  {model.status}
                </span>
              )}
            </div>
            {model.description && (
              <p
                style={{
                  fontSize: 11,
                  color: "var(--dpf-muted)",
                  margin: "0 0 4px",
                }}
              >
                {model.description}
              </p>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
                {model._count.roles} role{model._count.roles !== 1 ? "s" : ""}
              </span>
              <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
                {model._count.products} product{model._count.products !== 1 ? "s" : ""}
              </span>
              <span
                style={{
                  fontSize: 9,
                  color: "var(--dpf-muted)",
                  fontFamily: "monospace",
                }}
              >
                {model.modelId}
              </span>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 6,
              flexShrink: 0,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              onClick={() => onClone(model.modelId)}
              disabled={isPending}
              style={btnBase}
            >
              Clone
            </button>

            {!model.isBuiltIn && model.status === "active" && (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  disabled={isPending}
                  style={btnBase}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={handleDeprecate}
                  disabled={isPending}
                  style={{ ...btnBase, color: "var(--dpf-warning)", borderColor: "color-mix(in srgb, var(--dpf-warning) 25%, transparent)" }}
                >
                  Deprecate
                </button>
              </>
            )}

            {!model.isBuiltIn && model.status === "deprecated" && (
              <button
                type="button"
                onClick={handleRetire}
                disabled={isPending}
                style={{ ...btnBase, color: "var(--dpf-error)", borderColor: "color-mix(in srgb, var(--dpf-error) 25%, transparent)" }}
              >
                Retire
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function BusinessModelBuilder({ models }: { models: Model[] }) {
  const [view, setView] = useState<View>("list");

  const builtIn = models.filter((m) => m.isBuiltIn);
  const custom = models.filter((m) => !m.isBuiltIn);

  if (view !== "list") {
    const cloneSource = typeof view === "object" ? view.cloneId : null;
    return <CreateForm cloneSource={cloneSource} onDone={() => setView("list")} />;
  }

  return (
    <div>
      <div
        style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}
      >
        <button
          type="button"
          onClick={() => setView("create")}
          style={{
            fontSize: 12,
            background: "var(--dpf-accent)",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            cursor: "pointer",
            padding: "6px 14px",
          }}
        >
          + New business model
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <section>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--dpf-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 10px",
            }}
          >
            Built-in templates ({builtIn.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {builtIn.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                onClone={(id) => setView({ cloneId: id })}
              />
            ))}
          </div>
        </section>

        <section>
          <h2
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--dpf-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 10px",
            }}
          >
            Custom models ({custom.length})
          </h2>
          {custom.length === 0 ? (
            <p
              style={{
                fontSize: 12,
                color: "var(--dpf-muted)",
                fontStyle: "italic",
              }}
            >
              No custom business models yet. Clone a built-in template or create from
              scratch.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {custom.map((m) => (
                <ModelCard
                  key={m.id}
                  model={m}
                  onClone={(id) => setView({ cloneId: id })}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
