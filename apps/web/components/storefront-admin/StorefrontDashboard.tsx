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
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{config.orgName}</div>
          {config.tagline && <div style={{ fontSize: 13, color: "var(--dpf-muted)" }}>{config.tagline}</div>}
        </div>
        <a href={`/s/${config.orgSlug}`} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 13, color: "var(--dpf-accent, #4f46e5)", textDecoration: "none" }}>
          View Live ↗
        </a>
        <button onClick={togglePublish} disabled={toggling}
          style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: published ? "#ef4444" : "var(--dpf-accent, #4f46e5)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          {toggling ? "..." : published ? "Unpublish" : "Publish"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
        <StatTile label="Sections" value={config.sectionCount} />
        <StatTile label="Items" value={config.itemCount} />
        {ctaTiles.map((t) => <StatTile key={t.label} label={t.label} value={t.value} />)}
      </div>

      <div style={{ fontSize: 13, color: "var(--dpf-muted)" }}>
        Status: <strong style={{ color: published ? "#16a34a" : "#6b7280" }}>{published ? "Published" : "Unpublished"}</strong>
        {" · "} Archetype: {config.archetypeId}
        {" · "} <a href="/admin/storefront/settings" style={{ color: "var(--dpf-accent, #4f46e5)" }}>Edit settings</a>
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
