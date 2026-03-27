"use client";

import { useTransition } from "react";
import { assignBusinessModelToProduct, removeBusinessModelFromProduct } from "@/lib/actions/business-model";

type BusinessModelOption = {
  id: string;
  modelId: string;
  name: string;
  description: string | null;
  isBuiltIn: boolean;
  status: string;
  _count: { roles: number };
};

type AssignedModel = {
  id: string;
  assignedAt: Date;
  businessModel: { id: string; modelId: string; name: string; isBuiltIn: boolean };
};

type Props = {
  productId: string;
  availableModels: BusinessModelOption[];
  assignedModels: AssignedModel[];
};

const HITL_COLOURS: Record<string, string> = {
  true: "#7c8cf8",
  false: "#fbbf24",
};

export function BusinessModelSelector({ productId, availableModels, assignedModels }: Props) {
  const [isPending, startTransition] = useTransition();

  const assignedIds = new Set(assignedModels.map((a) => a.businessModel.id));
  const unassigned = availableModels.filter((m) => !assignedIds.has(m.id));
  const builtIn = unassigned.filter((m) => m.isBuiltIn);
  const custom = unassigned.filter((m) => !m.isBuiltIn);

  function handleAssign(businessModelId: string) {
    startTransition(async () => {
      await assignBusinessModelToProduct(productId, businessModelId);
    });
  }

  function handleRemove(businessModelId: string) {
    startTransition(async () => {
      await removeBusinessModelFromProduct(productId, businessModelId);
    });
  }

  return (
    <div style={{ opacity: isPending ? 0.7 : 1 }}>
      {/* Currently assigned */}
      {assignedModels.length > 0 && (
        <div style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {assignedModels.map((a) => {
            const colour = HITL_COLOURS[String(a.businessModel.isBuiltIn)];
            return (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "var(--dpf-surface-1)",
                  border: "1px solid var(--dpf-border)",
                  borderLeft: `3px solid ${colour}`,
                  borderRadius: 6,
                  padding: "4px 10px",
                  fontSize: 12,
                }}
              >
                <span style={{ color: "var(--dpf-text)", fontWeight: 500 }}>{a.businessModel.name}</span>
                {a.businessModel.isBuiltIn && (
                  <span style={{ fontSize: 9, color: colour, background: `${colour}20`, borderRadius: 3, padding: "1px 4px" }}>
                    built-in
                  </span>
                )}
                <button
                  onClick={() => handleRemove(a.businessModel.id)}
                  disabled={isPending}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--dpf-muted)",
                    cursor: "pointer",
                    fontSize: 14,
                    lineHeight: 1,
                    padding: "0 2px",
                  }}
                  title="Remove business model"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Selector */}
      {unassigned.length > 0 && (
        <select
          disabled={isPending}
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) handleAssign(e.target.value);
            e.target.value = "";
          }}
          style={{
            background: "var(--dpf-surface-1)",
            border: "1px solid var(--dpf-border)",
            borderRadius: 6,
            color: "var(--dpf-text)",
            fontSize: 12,
            padding: "5px 10px",
            cursor: "pointer",
          }}
        >
          <option value="" disabled>+ Assign business model…</option>
          {builtIn.length > 0 && (
            <optgroup label="Built-in templates">
              {builtIn.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m._count.roles} roles)
                </option>
              ))}
            </optgroup>
          )}
          {custom.length > 0 && (
            <optgroup label="Custom">
              {custom.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m._count.roles} roles)
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}

      {assignedModels.length === 0 && unassigned.length === 0 && (
        <p style={{ fontSize: 11, color: "var(--dpf-muted)" }}>All business models are assigned to this product.</p>
      )}
    </div>
  );
}
