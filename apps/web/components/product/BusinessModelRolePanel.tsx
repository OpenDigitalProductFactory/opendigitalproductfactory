"use client";

import { useState, useTransition } from "react";
import { assignUserToBusinessModelRole, revokeUserFromBusinessModelRole } from "@/lib/actions/business-model";

type UserOption = { id: string; email: string; displayName: string | null };

type Assignment = {
  id: string;
  userId: string;
  productId: string;
  assignedAt: Date;
  revokedAt: Date | null;
  user: { id: string; email: string };
};

type Role = {
  id: string;
  roleId: string;
  name: string;
  authorityDomain: string | null;
  it4itAlignment: string | null;
  hitlTierDefault: number;
  escalatesTo: string | null;
  isBuiltIn: boolean;
  status: string;
  assignments: Assignment[];
};

type AssignedBusinessModel = {
  id: string;
  assignedAt: Date;
  businessModel: {
    id: string;
    modelId: string;
    name: string;
    description: string | null;
    isBuiltIn: boolean;
    status: string;
    roles: Role[];
  };
};

type Props = {
  productId: string;
  assignedModels: AssignedBusinessModel[];
  users: UserOption[];
};

const HITL_COLOURS: Record<number, string> = {
  0: "var(--dpf-error)",
  1: "var(--dpf-warning)",
  2: "var(--dpf-info)",
  3: "var(--dpf-success)",
};

const ESCALATION_NAMES: Record<string, string> = {
  "HR-000": "CDIO / Executive Sponsor",
  "HR-100": "Portfolio Manager",
  "HR-200": "Digital Product Manager",
  "HR-300": "Enterprise Architect",
  "HR-400": "ITFM Director",
  "HR-500": "Operations Manager",
};

export function BusinessModelRolePanel({ productId, assignedModels, users }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();

  function toggleModel(modelId: string) {
    setExpanded((prev) => ({ ...prev, [modelId]: !prev[modelId] }));
  }

  function handleAssign(userId: string, businessModelRoleId: string) {
    startTransition(async () => {
      await assignUserToBusinessModelRole(userId, businessModelRoleId, productId);
    });
  }

  function handleRevoke(userId: string, businessModelRoleId: string) {
    startTransition(async () => {
      await revokeUserFromBusinessModelRole(userId, businessModelRoleId, productId);
    });
  }

  if (assignedModels.length === 0) {
    return (
      <p style={{ fontSize: 11, color: "var(--dpf-muted)", fontStyle: "italic" }}>
        No business model assigned. Use the selector above to add one.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, opacity: isPending ? 0.7 : 1 }}>
      {assignedModels.map((a) => {
        const isOpen = expanded[a.businessModel.modelId] !== false; // default open
        return (
          <div
            key={a.id}
            style={{
              background: "var(--dpf-surface-1)",
              border: "1px solid var(--dpf-border)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {/* Model header */}
            <button
              onClick={() => toggleModel(a.businessModel.modelId)}
              style={{
                width: "100%",
                background: "none",
                border: "none",
                borderBottom: isOpen ? "1px solid var(--dpf-border)" : "none",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)" }}>
                  {a.businessModel.name}
                </span>
                {a.businessModel.isBuiltIn && (
                  <span style={{ fontSize: 9, color: "var(--dpf-accent)", background: "color-mix(in srgb, var(--dpf-accent) 12%, transparent)", borderRadius: 3, padding: "1px 5px", marginLeft: 6 }}>
                    built-in
                  </span>
                )}
                <span style={{ fontSize: 10, color: "var(--dpf-muted)", marginLeft: 8 }}>
                  {a.businessModel.roles.length} role{a.businessModel.roles.length !== 1 ? "s" : ""}
                </span>
              </div>
              <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{isOpen ? "▾" : "▸"}</span>
            </button>

            {/* Role rows */}
            {isOpen && (
              <div style={{ padding: "8px 14px 12px" }}>
                {a.businessModel.roles.map((role) => {
                  const activeAssignment = role.assignments.find((asn) => asn.revokedAt === null);
                  const tierColour = HITL_COLOURS[role.hitlTierDefault] ?? "var(--dpf-muted)";
                  const escalationName = role.escalatesTo ? (ESCALATION_NAMES[role.escalatesTo] ?? role.escalatesTo) : null;

                  return (
                    <div
                      key={role.id}
                      style={{
                        borderBottom: "1px solid var(--dpf-border)",
                        padding: "10px 0",
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 8,
                        alignItems: "start",
                      }}
                    >
                      {/* Left: role info */}
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)" }}>
                            {role.name}
                          </span>
                          <span
                            style={{
                              fontSize: 9,
                              background: `color-mix(in srgb, ${tierColour} 12%, transparent)`,
                              color: tierColour,
                              borderRadius: 3,
                              padding: "1px 5px",
                            }}
                          >
                            HITL {role.hitlTierDefault}
                          </span>
                        </div>
                        {role.authorityDomain && (
                          <p style={{ fontSize: 10, color: "var(--dpf-muted)", margin: "0 0 2px" }}>
                            {role.authorityDomain}
                          </p>
                        )}
                        {role.it4itAlignment && (
                          <p style={{ fontSize: 9, color: "var(--dpf-muted)", margin: 0 }}>
                            IT4IT: {role.it4itAlignment}
                          </p>
                        )}
                        {escalationName && (
                          <p style={{ fontSize: 9, color: "var(--dpf-muted)", margin: "2px 0 0" }}>
                            Escalates to: {escalationName} ({role.escalatesTo})
                          </p>
                        )}
                      </div>

                      {/* Right: assignment control */}
                      <div style={{ textAlign: "right", minWidth: 160 }}>
                        {activeAssignment ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                            <span style={{ fontSize: 11, color: "var(--dpf-text)" }}>
                              {activeAssignment.user.email}
                            </span>
                            <button
                              onClick={() => handleRevoke(activeAssignment.userId, role.id)}
                              disabled={isPending}
                              style={{
                                fontSize: 10,
                                background: "none",
                                border: "1px solid var(--dpf-border)",
                                borderRadius: 4,
                                color: "var(--dpf-muted)",
                                cursor: "pointer",
                                padding: "2px 6px",
                              }}
                            >
                              Revoke
                            </button>
                          </div>
                        ) : (
                          <select
                            disabled={isPending}
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) handleAssign(e.target.value, role.id);
                              e.target.value = "";
                            }}
                            style={{
                              background: "var(--dpf-surface-2)",
                              border: "1px solid var(--dpf-border)",
                              borderRadius: 4,
                              color: "var(--dpf-muted)",
                              fontSize: 10,
                              padding: "3px 6px",
                              cursor: "pointer",
                              maxWidth: 160,
                            }}
                          >
                            <option value="" disabled>Assign user…</option>
                            {users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.displayName ?? u.email}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
