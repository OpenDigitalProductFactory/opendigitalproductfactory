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

const inputStyle = {
  padding: "8px 12px",
  border: "1px solid var(--dpf-border)",
  borderRadius: 6,
  fontSize: 14,
  background: "var(--dpf-surface-1)",
  color: "var(--dpf-text)",
} as const;

const labelStyle = { fontSize: 13, fontWeight: 500, color: "var(--dpf-text)" } as const;
const fieldStyle = { display: "flex", flexDirection: "column", gap: 4 } as const;

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
    const name = (fd.get("customerName") as string)?.trim() || undefined;
    const quantity = Math.max(1, Number(fd.get("quantity")) || 1);

    const line1 = (fd.get("addrLine1") as string)?.trim();
    const line2 = (fd.get("addrLine2") as string)?.trim() || undefined;
    const city = (fd.get("addrCity") as string)?.trim();
    const county = (fd.get("addrCounty") as string)?.trim() || undefined;
    const postcode = (fd.get("addrPostcode") as string)?.trim();
    const country = (fd.get("addrCountry") as string)?.trim() || "US";

    const deliveryAddress =
      line1 && city && postcode
        ? { line1, line2, city, county, postcode, country }
        : undefined;

    // totalAmount is recomputed and price-validated server-side in submitOrder;
    // we send the line for completeness only.
    const result = await submitOrder(orgSlug, {
      customerEmail: email,
      customerName: name,
      deliveryAddress,
      items: [{ itemId, name: itemName, qty: quantity, unitPrice }],
      totalAmount: unitPrice * quantity,
      currency,
    });

    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push(`/s/${orgSlug}/checkout?ref=${result.data.ref}&type=order`);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
      {error && <div style={{ color: "var(--dpf-error)", fontSize: 13 }}>{error}</div>}

      <div style={fieldStyle}>
        <label style={labelStyle}>Full name *</label>
        <input type="text" name="customerName" required style={inputStyle} placeholder="Jane Smith" />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Email address *</label>
        <input type="email" name="email" required style={inputStyle} />
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Quantity *</label>
        <input
          type="number"
          name="quantity"
          min={1}
          step={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          required
          style={{ ...inputStyle, maxWidth: 120 }}
        />
      </div>

      <fieldset style={{ border: "1px solid var(--dpf-border)", borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <legend style={{ fontSize: 12, color: "var(--dpf-muted)", padding: "0 4px" }}>Delivery address</legend>

        <div style={fieldStyle}>
          <label style={labelStyle}>Address line 1 *</label>
          <input type="text" name="addrLine1" required style={inputStyle} placeholder="123 Main St" />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Address line 2</label>
          <input type="text" name="addrLine2" style={inputStyle} placeholder="Apt, suite, unit…" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>City *</label>
            <input type="text" name="addrCity" required style={inputStyle} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>State / County</label>
            <input type="text" name="addrCounty" style={inputStyle} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>ZIP / Postcode *</label>
            <input type="text" name="addrPostcode" required style={inputStyle} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Country</label>
            <input type="text" name="addrCountry" defaultValue="US" style={inputStyle} />
          </div>
        </div>
      </fieldset>

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
