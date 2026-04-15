"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEaView } from "@/lib/actions/ea";

const NOTATION_OPTIONS = [
  { slug: "archimate4", label: "ArchiMate 4" },
  { slug: "bpmn20", label: "BPMN 2.0" },
] as const;

const LAYOUT_OPTIONS = [
  { value: "graph", label: "Graph" },
  { value: "swimlane", label: "Swimlane" },
] as const;

export function CreateViewButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [notationSlug, setNotationSlug] = useState<string>(NOTATION_OPTIONS[0].slug);
  const [layoutType, setLayoutType] = useState<string>(LAYOUT_OPTIONS[0].value);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpen() {
    setName("");
    setNotationSlug(NOTATION_OPTIONS[0].slug);
    setLayoutType(LAYOUT_OPTIONS[0].value);
    setError(null);
    setOpen(true);
  }

  function handleClose() {
    if (isPending) return;
    setOpen(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    setError(null);

    startTransition(async () => {
      const result = await createEaView({
        name: trimmed,
        notationSlug,
        layoutType,
        scopeType: "custom",
      });

      if ("error" in result) {
        setError(result.error);
        return;
      }

      setOpen(false);
      router.push(`/ea/views/${result.id}`);
    });
  }

  return (
    <>
      <button
        onClick={handleOpen}
        style={{
          padding: "6px 14px",
          background: "var(--dpf-accent)",
          border: "none",
          borderRadius: 5,
          color: "#fff",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        + New view
      </button>

      {open && (
        <div
          onClick={handleClose}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "color-mix(in srgb, var(--dpf-text) 50%, transparent)",
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmit}
            style={{
              width: 360,
              background: "var(--dpf-surface-1)",
              border: "1px solid var(--dpf-border)",
              borderRadius: 8,
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--dpf-text)" }}>
              Create New View
            </h2>

            {/* Name */}
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-muted)", textTransform: "uppercase" }}>
                Name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Application Landscape"
                autoFocus
                style={{
                  padding: "6px 8px",
                  background: "var(--dpf-bg)",
                  border: "1px solid var(--dpf-border)",
                  borderRadius: 4,
                  color: "var(--dpf-text)",
                  fontSize: 12,
                }}
              />
            </label>

            {/* Notation */}
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-muted)", textTransform: "uppercase" }}>
                Notation
              </span>
              <select
                value={notationSlug}
                onChange={(e) => setNotationSlug(e.target.value)}
                style={{
                  padding: "6px 8px",
                  background: "var(--dpf-bg)",
                  border: "1px solid var(--dpf-border)",
                  borderRadius: 4,
                  color: "var(--dpf-text)",
                  fontSize: 12,
                }}
              >
                {NOTATION_OPTIONS.map((opt) => (
                  <option key={opt.slug} value={opt.slug}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            {/* Layout */}
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-muted)", textTransform: "uppercase" }}>
                Layout
              </span>
              <select
                value={layoutType}
                onChange={(e) => setLayoutType(e.target.value)}
                style={{
                  padding: "6px 8px",
                  background: "var(--dpf-bg)",
                  border: "1px solid var(--dpf-border)",
                  borderRadius: 4,
                  color: "var(--dpf-text)",
                  fontSize: 12,
                }}
              >
                {LAYOUT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            {error != null && (
              <p style={{ margin: 0, fontSize: 11, color: "#ff4444" }}>{error}</p>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={handleClose}
                disabled={isPending}
                style={{
                  padding: "6px 14px",
                  background: "transparent",
                  border: "1px solid var(--dpf-border)",
                  borderRadius: 5,
                  color: "var(--dpf-muted)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                style={{
                  padding: "6px 14px",
                  background: "var(--dpf-accent)",
                  border: "none",
                  borderRadius: 5,
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: isPending ? "wait" : "pointer",
                  opacity: isPending ? 0.7 : 1,
                }}
              >
                {isPending ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
