"use client";
import { useState } from "react";

type DashboardConfig = {
  id: string;
  isPublished: boolean;
  tagline: string | null;
  orgSlug: string;
  orgName: string;
  archetypeId: string;
  ctaType: string;
  sectionCount: number;
  itemCount: number;
};

type Counts = { inquiries: number; bookings: number; orders: number; donations: number };

export function StorefrontDashboard({ config, counts }: { config: DashboardConfig; counts: Counts }) {
  const [published, setPublished] = useState(config.isPublished);
  const [toggling, setToggling] = useState(false);

  async function togglePublish() {
    setToggling(true);
    try {
      const res = await fetch(`/api/storefront/admin/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: config.id, isPublished: !published }),
      });
      if (res.ok) setPublished((p) => !p);
    } finally {
      setToggling(false);
    }
  }

  const ctaTiles = [
    { label: "Inquiries", value: counts.inquiries, types: ["inquiry"] },
    { label: "Bookings", value: counts.bookings, types: ["booking"] },
    { label: "Orders", value: counts.orders, types: ["purchase"] },
    { label: "Donations", value: counts.donations, types: ["donation"] },
  ].filter((t) => t.types.includes(config.ctaType) || t.label === "Inquiries");

  return (
    <div>
      {/* Publish gate is deliberate (unpublished by default), but operators were
          not prompted to publish after the wizard and assumed the 404 portal was
          broken. Surface a prominent call-to-action whenever the portal is not
          yet live. */}
      {!published && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 24,
            padding: "14px 16px",
            borderRadius: 8,
            border: "1px solid var(--dpf-accent)",
            background: "color-mix(in srgb, var(--dpf-accent) 12%, transparent)",
          }}
        >
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--dpf-text)" }}>
              Your storefront is ready — publish it now
            </div>
            <div style={{ marginTop: 2, fontSize: 13, color: "var(--dpf-muted)" }}>
              It is not live yet, so the public link returns a 404. Publish it so customers can find you.
            </div>
          </div>
          <button
            onClick={togglePublish}
            disabled={toggling}
            style={{
              padding: "8px 18px",
              borderRadius: 6,
              border: "none",
              background: "var(--dpf-accent)",
              color: "white",
              cursor: toggling ? "wait" : "pointer",
              fontSize: 14,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {toggling ? "Publishing..." : "Publish now"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{config.orgName}</div>
          {config.tagline && <div style={{ fontSize: 13, color: "var(--dpf-muted)" }}>{config.tagline}</div>}
        </div>
        <a href={`/s/${config.orgSlug}`} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 13, color: "var(--dpf-accent)", textDecoration: "none" }}>
          View Live ↗
        </a>
        <button onClick={togglePublish} disabled={toggling}
          style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: published ? "var(--dpf-error)" : "var(--dpf-accent)", color: "white", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          {toggling ? "..." : published ? "Unpublish" : "Publish"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
        <StatTile label="Sections" value={config.sectionCount} />
        <StatTile label="Items" value={config.itemCount} />
        {ctaTiles.map((t) => <StatTile key={t.label} label={t.label} value={t.value} />)}
      </div>

      <div style={{ fontSize: 13, color: "var(--dpf-muted)" }}>
        Status: <strong style={{ color: published ? "var(--dpf-success)" : "var(--dpf-muted)" }}>{published ? "Published" : "Unpublished"}</strong>
        {" · "} Archetype: {config.archetypeId}
        {" · "} <a href="/storefront/settings" style={{ color: "var(--dpf-accent)" }}>Edit settings</a>
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: "1px solid var(--dpf-border)", borderRadius: 8, padding: "12px 16px" }}>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--dpf-muted)" }}>{label}</div>
    </div>
  );
}
