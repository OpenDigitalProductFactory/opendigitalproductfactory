"use client";
import { useState } from "react";

type Item = {
  id: string;
  itemId: string;
  name: string;
  description: string | null;
  priceAmount: string | null;
  priceCurrency: string;
  priceType: string | null;
  ctaType: string;
  isActive: boolean;
  sortOrder: number;
};

export function ItemsManager({ storefrontId, items: initial }: { storefrontId: string; items: Item[] }) {
  const [items, setItems] = useState(initial);

  async function toggleActive(id: string, isActive: boolean) {
    await fetch(`/api/storefront/admin/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, isActive } : i));
  }

  return (
    <div>
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Items / Services</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--dpf-border)", textAlign: "left" }}>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>Name</th>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>Price</th>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>CTA</th>
              <th style={{ padding: "8px 12px", fontWeight: 600 }}>Active</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                <td style={{ padding: "8px 12px" }}>
                  <div style={{ fontWeight: 500 }}>{item.name}</div>
                  {item.description && <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>{item.description}</div>}
                </td>
                <td style={{ padding: "8px 12px" }}>
                  {item.priceAmount
                    ? `${item.priceCurrency === "GBP" ? "£" : item.priceCurrency}${item.priceAmount}`
                    : item.priceType ?? "—"}
                </td>
                <td style={{ padding: "8px 12px" }}>{item.ctaType}</td>
                <td style={{ padding: "8px 12px" }}>
                  <button
                    onClick={() => toggleActive(item.id, !item.isActive)}
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 4,
                      border: "1px solid var(--dpf-border)",
                      background: "var(--dpf-surface-1)",
                      color: "var(--dpf-text)",
                      cursor: "pointer",
                    }}
                  >
                    {item.isActive ? "Active" : "Inactive"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
