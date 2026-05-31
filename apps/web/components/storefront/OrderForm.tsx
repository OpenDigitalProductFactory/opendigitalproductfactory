"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitOrder } from "@/lib/storefront-actions";

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function OrderForm({
  orgSlug,
  itemId,
  itemName,
  unitPrice,
  currency,
}: {
  orgSlug: string;
  itemId: string;
  itemName: string;
  unitPrice: number;
  currency: string;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = unitPrice * qty;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const email = (fd.get("email") as string)?.trim();
    const quantity = Math.max(1, Number(fd.get("quantity")) || 1);

    // totalAmount is recomputed and price-validated server-side in submitOrder;
    // we send the line for completeness only.
    const result = await submitOrder(orgSlug, {
      customerEmail: email,
      items: [{ itemId, name: itemName, qty: quantity, unitPrice }],
      totalAmount: unitPrice * quantity,
      currency,
    });

    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push(`/s/${orgSlug}/checkout?ref=${result.ref}&type=order`);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
      {error && <div style={{ color: "var(--dpf-error)", fontSize: 13 }}>{error}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: "var(--dpf-text)" }}>Email address *</label>
        <input
          type="email"
          name="email"
          required
          style={{ padding: "8px 12px", border: "1px solid var(--dpf-border)", borderRadius: 6, fontSize: 14 }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: "var(--dpf-text)" }}>Quantity *</label>
        <input
          type="number"
          name="quantity"
          min={1}
          step={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          required
          style={{ padding: "8px 12px", border: "1px solid var(--dpf-border)", borderRadius: 6, fontSize: 14, maxWidth: 120 }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "var(--dpf-text)", borderTop: "1px solid var(--dpf-border)", paddingTop: 12 }}>
        <span style={{ color: "var(--dpf-muted)" }}>
          {formatMoney(unitPrice, currency)} × {qty}
        </span>
        <strong>{formatMoney(total, currency)}</strong>
      </div>

      <button
        type="submit"
        disabled={loading}
        style={{
          padding: "10px 20px",
          background: "var(--dpf-accent, #4f46e5)",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Placing order…" : `Place order — ${formatMoney(total, currency)}`}
      </button>
    </form>
  );
}
