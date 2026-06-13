"use client";

// Admin manager for rentable units (equipment-rental / self-storage fleet).
// Creates units under a rental class (the rate-card StorefrontItem) and, per unit,
// embeds the reusable MediaUploader for equipment photos. Units are grouped by
// class so an operator sees their fleet the way they think about it.

import { useMemo, useState } from "react";
import { MediaUploader } from "./MediaUploader";

interface MediaItem {
  attachmentId: string;
  assetId: string;
  url: string;
  altText: string | null;
  caption: string | null;
}

interface AdminUnit {
  id: string;
  unitId: string;
  storefrontItemId: string;
  label: string;
  unitRef: string | null;
  status: string;
  media: MediaItem[];
}

interface RentalClass {
  id: string;
  name: string;
}

const STATUSES = ["available", "reserved", "out", "returned", "maintenance", "retired"];

const inputStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 8px",
  border: "1px solid var(--dpf-border)",
  borderRadius: 6,
  background: "var(--dpf-bg, transparent)",
  color: "var(--dpf-text)",
};

export function UnitsManager({
  classes,
  units: initial,
}: {
  classes: RentalClass[];
  units: AdminUnit[];
}) {
  const [units, setUnits] = useState<AdminUnit[]>(initial);
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [unitRef, setUnitRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byClass = useMemo(() => {
    const map = new Map<string, AdminUnit[]>();
    for (const u of units) {
      const list = map.get(u.storefrontItemId) ?? [];
      list.push(u);
      map.set(u.storefrontItemId, list);
    }
    return map;
  }, [units]);

  async function createUnit() {
    if (!classId) {
      setError("Pick a rental class first.");
      return;
    }
    if (!label.trim()) {
      setError("A unit label is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/storefront/admin/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storefrontItemId: classId, label, unitRef }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not add unit.");
        return;
      }
      const created = (await res.json()) as AdminUnit;
      setUnits((prev) => [...prev, { ...created, media: [] }]);
      setLabel("");
      setUnitRef("");
    } finally {
      setBusy(false);
    }
  }

  async function updateUnit(id: string, patch: Partial<AdminUnit>) {
    setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
    await fetch(`/api/storefront/admin/units/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function deleteUnit(id: string) {
    await fetch(`/api/storefront/admin/units/${id}`, { method: "DELETE" });
    setUnits((prev) => prev.filter((u) => u.id !== id));
  }

  if (classes.length === 0) {
    return (
      <div style={{ fontSize: 13, color: "var(--dpf-muted)", maxWidth: 640 }}>
        No rental classes yet. Add a rental item (CTA type “rental”) under Items first, then come
        back here to stock individual units with their photos.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "var(--dpf-text)" }}>Units &amp; fleet</h1>
        <p style={{ fontSize: 13, color: "var(--dpf-muted)" }}>
          Stock individual units under each rental class and give each one photos — condition
          baseline and listing imagery for renters.
        </p>
      </div>

      {/* Create */}
      <div
        style={{
          border: "1px solid var(--dpf-border)",
          borderRadius: 8,
          padding: 16,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "end",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--dpf-muted)" }}>Rental class</span>
          <select style={inputStyle} value={classId} onChange={(e) => setClassId(e.target.value)}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--dpf-muted)" }}>Label *</span>
          <input style={inputStyle} value={label} placeholder="e.g. Excavator #2"
            onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--dpf-muted)" }}>Serial / plate</span>
          <input style={inputStyle} value={unitRef} placeholder="optional"
            onChange={(e) => setUnitRef(e.target.value)} />
        </label>
        <button type="button" onClick={() => void createUnit()} disabled={busy}
          style={{
            fontSize: 13, padding: "8px 14px", borderRadius: 6, border: "none",
            background: "var(--dpf-accent, #2563eb)", color: "#fff",
            cursor: busy ? "default" : "pointer",
          }}>
          {busy ? "Adding…" : "Add unit"}
        </button>
        {error && <div style={{ fontSize: 12, color: "var(--dpf-danger, #dc2626)", width: "100%" }}>{error}</div>}
      </div>

      {/* Grouped list */}
      {classes.map((c) => {
        const list = byClass.get(c.id) ?? [];
        if (list.length === 0) return null;
        return (
          <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--dpf-text)" }}>{c.name}</h2>
            {list.map((unit) => (
              <div key={unit.id}
                style={{ border: "1px solid var(--dpf-border)", borderRadius: 8, padding: 16,
                  display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <input style={{ ...inputStyle, width: 200, fontWeight: 600 }} value={unit.label}
                    onChange={(e) => updateUnit(unit.id, { label: e.target.value })} />
                  <input style={{ ...inputStyle, width: 140 }} value={unit.unitRef ?? ""}
                    placeholder="serial / plate"
                    onChange={(e) => updateUnit(unit.id, { unitRef: e.target.value })} />
                  <select style={{ ...inputStyle, width: 140 }} value={unit.status}
                    onChange={(e) => updateUnit(unit.id, { status: e.target.value })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <span style={{ fontSize: 11, color: "var(--dpf-muted)" }}>{unit.unitId}</span>
                  <button type="button" onClick={() => void deleteUnit(unit.id)}
                    style={{ marginLeft: "auto", fontSize: 12, padding: "4px 10px",
                      border: "1px solid var(--dpf-border)", borderRadius: 6, background: "transparent",
                      color: "var(--dpf-danger, #dc2626)", cursor: "pointer" }}>
                    Delete
                  </button>
                </div>
                <MediaUploader
                  ownerType="RentableUnit"
                  ownerId={unit.id}
                  role="equipment"
                  label="Equipment photos"
                  hint="Condition baseline + listing imagery"
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
