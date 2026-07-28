"use client";

import { useState } from "react";
import type { ProductMixDefinition } from "@dpf/storefront-templates";

import type { ProductLineSelection } from "@/lib/products/setup-product-mix";

export function defaultProductLineSelections(
  productMix: ProductMixDefinition,
): ProductLineSelection[] {
  return [
    {
      suggestionKey: productMix.primary.key,
      label: productMix.primary.label,
    },
  ];
}

export function ProductMixSetupFieldset({
  productMix,
  value,
  onChange,
}: {
  productMix: ProductMixDefinition;
  value: ProductLineSelection[];
  onChange: (value: ProductLineSelection[]) => void;
}) {
  const [customLabel, setCustomLabel] = useState("");
  const primary =
    value.find(
      (selection) => selection.suggestionKey === productMix.primary.key,
    ) ?? defaultProductLineSelections(productMix)[0];
  const custom = value.filter((selection) => selection.suggestionKey === null);

  function replace(selection: ProductLineSelection) {
    onChange(
      value.map((current) =>
        current.suggestionKey === selection.suggestionKey ? selection : current,
      ),
    );
  }

  function toggleAdjacent(key: string, label: string, selected: boolean) {
    onChange(
      selected
        ? [...value, { suggestionKey: key, label }]
        : value.filter((selection) => selection.suggestionKey !== key),
    );
  }

  function addCustom() {
    const label = customLabel.trim();
    if (!label) return;
    onChange([...value, { suggestionKey: null, label }]);
    setCustomLabel("");
  }

  return (
    <fieldset
      className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
      style={{ borderRadius: 8, padding: 16, marginBottom: 16 }}
    >
      <legend style={{ paddingInline: 4, fontSize: 14, fontWeight: 700 }}>
        What does your business sell?
      </legend>
      <p
        className="text-[var(--dpf-muted)]"
        style={{ fontSize: 12, margin: "0 0 12px" }}
      >
        Start with the main line below. Add another only if customers buy
        something meaningfully different from you.
      </p>

      <label style={{ display: "block", fontSize: 12, fontWeight: 600 }}>
        Main product line
        <input
          required
          type="text"
          value={primary.label}
          maxLength={80}
          onChange={(event) =>
            replace({ ...primary, label: event.target.value })
          }
          className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-0)] text-[var(--dpf-text)]"
          style={{
            display: "block",
            width: "100%",
            maxWidth: 420,
            minHeight: 40,
            marginTop: 4,
            borderRadius: 6,
            padding: "8px 12px",
          }}
        />
      </label>

      {(productMix.adjacent ?? []).length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
            Also sell
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {(productMix.adjacent ?? []).map((line) => {
              const selected = value.some(
                (selection) => selection.suggestionKey === line.key,
              );
              return (
                <label
                  key={line.key}
                  className="border border-[var(--dpf-border)]"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    minHeight: 44,
                    borderRadius: 6,
                    padding: "8px 10px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) =>
                      toggleAdjacent(
                        line.key,
                        line.label,
                        event.target.checked,
                      )
                    }
                  />
                  <span>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
                      {line.label}
                    </span>
                    {line.description && (
                      <span
                        className="text-[var(--dpf-muted)]"
                        style={{ display: "block", fontSize: 12 }}
                      >
                        {line.description}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {custom.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {custom.map((line, index) => (
            <div
              key={`custom-${index}`}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <label style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>
                Added product line
                <input
                  type="text"
                  value={line.label}
                  maxLength={80}
                  onChange={(event) =>
                    onChange(
                      value.map((current) =>
                        current === line
                          ? { ...current, label: event.target.value }
                          : current,
                      ),
                    )
                  }
                  className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-0)] text-[var(--dpf-text)]"
                  style={{
                    display: "block",
                    width: "100%",
                    minHeight: 40,
                    marginTop: 4,
                    borderRadius: 6,
                    padding: "8px 12px",
                  }}
                />
              </label>
              <button
                type="button"
                aria-label={`Remove ${line.label || "product line"}`}
                onClick={() =>
                  onChange(value.filter((current) => current !== line))
                }
                className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-0)] text-[var(--dpf-text)]"
                style={{ minHeight: 40, borderRadius: 6, padding: "8px 12px" }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <label style={{ minWidth: 220, flex: "0 1 320px", fontSize: 12 }}>
          Another product line
          <input
            type="text"
            value={customLabel}
            maxLength={80}
            placeholder="e.g. Conferences and events"
            onChange={(event) => setCustomLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCustom();
              }
            }}
            className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-0)] text-[var(--dpf-text)]"
            style={{
              display: "block",
              width: "100%",
              minHeight: 40,
              marginTop: 4,
              borderRadius: 6,
              padding: "8px 12px",
            }}
          />
        </label>
        <button
          type="button"
          onClick={addCustom}
          disabled={!customLabel.trim()}
          className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-0)] text-[var(--dpf-text)]"
          style={{
            alignSelf: "flex-end",
            minHeight: 40,
            borderRadius: 6,
            padding: "8px 12px",
            opacity: customLabel.trim() ? 1 : 0.6,
          }}
        >
          Add product line
        </button>
      </div>
    </fieldset>
  );
}
