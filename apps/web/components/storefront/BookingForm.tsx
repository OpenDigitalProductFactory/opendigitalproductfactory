"use client";

import { useState } from "react";
import { submitBooking } from "@/lib/storefront-actions";
import { useRouter } from "next/navigation";

export function BookingForm({
  orgSlug,
  itemId,
  itemName,
  durationMinutes,
}: {
  orgSlug: string;
  itemId: string;
  itemName: string;
  durationMinutes: number;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const date = fd.get("date") as string;
    const time = fd.get("time") as string;
    const scheduledAt = new Date(`${date}T${time}:00`);

    const result = await submitBooking(orgSlug, {
      itemId,
      customerEmail: fd.get("email") as string,
      customerName: fd.get("name") as string,
      customerPhone: (fd.get("phone") as string | null) ?? undefined,
      scheduledAt,
      durationMinutes,
      notes: (fd.get("notes") as string | null) ?? undefined,
    });

    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push(`/s/${orgSlug}/checkout?ref=${result.ref}&type=booking`);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
      {error && <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>}
      {[
        { name: "name", label: "Full name", type: "text" },
        { name: "email", label: "Email address", type: "email" },
        { name: "phone", label: "Phone (optional)", type: "tel", required: false },
      ].map((f) => (
        <div key={f.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>{f.label}</label>
          <input type={f.type} name={f.name} required={f.required !== false}
            style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }} />
        </div>
      ))}
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>Date *</label>
          <input type="date" name="date" required
            min={new Date().toISOString().split("T")[0]}
            style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>Time *</label>
          <input type="time" name="time" required
            style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }} />
        </div>
      </div>
      <div style={{ fontSize: 13, color: "#6b7280" }}>Duration: {durationMinutes} minutes</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 13, fontWeight: 500 }}>Notes (optional)</label>
        <textarea name="notes" rows={3}
          style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, resize: "vertical" }} />
      </div>
      <button type="submit" disabled={loading}
        style={{ padding: "10px 20px", background: "var(--dpf-accent, #4f46e5)", color: "#fff", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
        {loading ? "Booking…" : `Book ${itemName}`}
      </button>
    </form>
  );
}
