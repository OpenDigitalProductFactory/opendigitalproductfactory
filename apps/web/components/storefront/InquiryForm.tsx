"use client";

import { useState } from "react";
import { submitInquiry } from "@/lib/storefront-actions";
import { useRouter } from "next/navigation";

type FormField = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  placeholder?: string;
};

export function InquiryForm({
  orgSlug,
  itemId,
  formSchema,
}: {
  orgSlug: string;
  itemId?: string;
  formSchema: FormField[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const email = fd.get("email") as string;
    const name = fd.get("name") as string;
    const phone = (fd.get("phone") as string | null) ?? undefined;
    const message = (fd.get("message") as string | null) ?? undefined;

    const formData: Record<string, unknown> = {};
    for (const field of formSchema) {
      if (!["name", "email", "phone", "notes", "message"].includes(field.name)) {
        const val = fd.get(field.name);
        if (val !== null) formData[field.name] = val;
      }
    }

    const result = await submitInquiry(orgSlug, {
      customerEmail: email,
      customerName: name,
      customerPhone: phone || undefined,
      message: message || undefined,
      itemId,
      formData: Object.keys(formData).length > 0 ? formData : undefined,
    });

    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push(`/s/${orgSlug}/checkout?ref=${result.ref}&type=inquiry`);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
      {error && <div style={{ color: "var(--dpf-error)", fontSize: 13 }}>{error}</div>}
      {formSchema.map((field) => (
        <div key={field.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 13, fontWeight: 500, color: "var(--dpf-text)" }}>
            {field.label}{field.required && " *"}
          </label>
          {field.type === "textarea" ? (
            <textarea name={field.name} required={field.required} rows={4}
              style={{ padding: "8px 12px", border: "1px solid var(--dpf-border)", borderRadius: 6, fontSize: 14, resize: "vertical" }} />
          ) : field.type === "select" ? (
            <select name={field.name} required={field.required}
              style={{ padding: "8px 12px", border: "1px solid var(--dpf-border)", borderRadius: 6, fontSize: 14 }}>
              <option value="">Select…</option>
              {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input type={field.type} name={field.name} required={field.required}
              placeholder={field.placeholder}
              style={{ padding: "8px 12px", border: "1px solid var(--dpf-border)", borderRadius: 6, fontSize: 14 }} />
          )}
        </div>
      ))}
      <button type="submit" disabled={loading}
        style={{
          padding: "10px 20px", background: "var(--dpf-accent, #4f46e5)", color: "var(--dpf-text)",
          border: "none", borderRadius: 6, fontSize: 14, fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer",
        }}>
        {loading ? "Sending…" : "Send Enquiry"}
      </button>
    </form>
  );
}
