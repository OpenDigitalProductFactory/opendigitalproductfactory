"use client";

import { useState } from "react";
import { submitDonation } from "@/lib/storefront-actions";
import { useRouter } from "next/navigation";

const PRESET_AMOUNTS = [5, 10, 25, 50, 100];

export function DonationForm({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const amountVal = selected ?? parseFloat(custom);
    if (!amountVal || amountVal <= 0) {
      setError("Please select or enter a donation amount.");
      setLoading(false);
      return;
    }

    const result = await submitDonation(orgSlug, {
      donorEmail: fd.get("email") as string,
      donorName: (fd.get("name") as string | null) ?? undefined,
      amount: amountVal.toString(),
      message: (fd.get("message") as string | null) ?? undefined,
      isAnonymous: fd.get("anonymous") === "on",
    });

    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push(`/s/${orgSlug}/checkout?ref=${result.ref}&type=donation`);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 480 }}>
      {error && <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>}
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Select amount</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {PRESET_AMOUNTS.map((amt) => (
            <button key={amt} type="button"
              onClick={() => { setSelected(amt); setCustom(""); }}
              style={{
                padding: "8px 16px", borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: "pointer",
                background: selected === amt ? "var(--dpf-accent, #4f46e5)" : "var(--dpf-surface-2)",
                color: selected === amt ? "var(--dpf-text)" : "var(--dpf-text)",
                border: "none",
              }}>
              £{amt}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, color: "var(--dpf-muted)" }}>Custom: £</span>
          <input type="number" min="1" step="0.01" value={custom}
            onChange={(e) => { setCustom(e.target.value); setSelected(null); }}
            placeholder="Other amount"
            style={{ padding: "6px 10px", border: "1px solid var(--dpf-border)", borderRadius: 6, fontSize: 14, width: 120 }} />
        </div>
      </div>
      {[
        { name: "email", label: "Email address *", type: "email", required: true },
        { name: "name", label: "Your name (optional)", type: "text", required: false },
      ].map((f) => (
        <div key={f.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>{f.label}</label>
          <input type={f.type} name={f.name} required={f.required}
            style={{ padding: "8px 12px", border: "1px solid var(--dpf-border)", borderRadius: 6, fontSize: 14 }} />
        </div>
      ))}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 13, fontWeight: 500 }}>Message (optional)</label>
        <textarea name="message" rows={3}
          style={{ padding: "8px 12px", border: "1px solid var(--dpf-border)", borderRadius: 6, fontSize: 14, resize: "vertical" }} />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" name="anonymous" />
        Make this donation anonymous
      </label>
      <button type="submit" disabled={loading}
        style={{ padding: "10px 20px", background: "var(--dpf-accent, #4f46e5)", color: "var(--dpf-text)", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
        {loading ? "Processing…" : "Donate"}
      </button>
    </form>
  );
}
