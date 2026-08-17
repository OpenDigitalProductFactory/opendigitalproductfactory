"use client";

import { useRef, useState, useEffect } from "react";
import { submitInquiry } from "@/lib/storefront-actions";
import { useRouter } from "next/navigation";
import {
  validateRequiredFields,
  errorId,
  type FieldErrors,
  type ValidatableField,
} from "@/lib/storefront/form-validation";

type FormField = {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  placeholder?: string;
};

const FORM_ID = "inquiry";

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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(() => ({}));
  const [errorOrder, setErrorOrder] = useState<string[]>([]);
  const [calcSnapshot, setCalcSnapshot] = useState<Record<string, unknown> | null>(null);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("dpf_calc_snapshot");
    if (raw) {
      try { setCalcSnapshot(JSON.parse(raw)); } catch { /* ignore malformed */ }
    }
  }, []);

  function readValues(form: HTMLFormElement): Record<string, string> {
    const fd = new FormData(form);
    const values: Record<string, string> = {};
    for (const field of formSchema) {
      const v = fd.get(field.name);
      values[field.name] = typeof v === "string" ? v : "";
    }
    return values;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;

    // Visible, accessible validation — not browser-native blocking only.
    const values = readValues(form);
    const validation = validateRequiredFields(formSchema as ValidatableField[], values);
    if (!validation.valid) {
      setFieldErrors(validation.errors);
      setErrorOrder(validation.order);
      // Move focus to the summary so screen readers and keyboard users land on it.
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setFieldErrors({});
    setErrorOrder([]);

    setLoading(true);
    setError(null);

    const email = values.email;
    const name = values.name;
    const phone = values.phone || undefined;
    // Archetype schemas use a "notes" textarea for free-text; the generic schema
    // uses "message". Treat either as the inquiry message.
    const message = values.message || values.notes || undefined;

    const formData: Record<string, unknown> = {};
    for (const field of formSchema) {
      if (!["name", "email", "phone", "notes", "message"].includes(field.name)) {
        const val = values[field.name];
        if (val) formData[field.name] = val;
      }
    }

    if (calcSnapshot) formData.calculatorSnapshot = calcSnapshot;

    const result = await submitInquiry(orgSlug, {
      customerEmail: email,
      customerName: name,
      customerPhone: phone,
      message,
      itemId,
      formData: Object.keys(formData).length > 0 ? formData : undefined,
    });

    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    // Result-named route — an enquiry is not a checkout (BI-F20763F5).
    router.push(`/s/${orgSlug}/inquiry/received?ref=${encodeURIComponent(result.data.ref)}`);
  }

  const labelByName = new Map(formSchema.map((f) => [f.name, f.label] as const));

  return (
    <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
      {errorOrder.length > 0 && (
        <div
          ref={summaryRef}
          role="alert"
          tabIndex={-1}
          className="border border-[var(--dpf-error)]"
          style={{
            borderRadius: 8,
            padding: "12px 14px",
            background: "color-mix(in srgb, var(--dpf-error) 8%, transparent)",
            outline: "none",
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-error)", marginBottom: errorOrder.length ? 6 : 0 }}>
            Please check the following {errorOrder.length === 1 ? "field" : `${errorOrder.length} fields`}:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {errorOrder.map((name) => (
              <li key={name} style={{ fontSize: 13 }}>
                <a href={`#${FORM_ID}-${name}`} style={{ color: "var(--dpf-error)" }}>
                  {fieldErrors[name] ?? `${labelByName.get(name) ?? name} is required`}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div role="alert" style={{ color: "var(--dpf-error)", fontSize: 13 }}>{error}</div>}

      {formSchema.map((field) => {
        const fieldError = fieldErrors[field.name];
        const describedBy = fieldError ? errorId(FORM_ID, field.name) : undefined;
        const inputId = `${FORM_ID}-${field.name}`;
        const commonStyle = {
          padding: "8px 12px",
          border: `1px solid ${fieldError ? "var(--dpf-error)" : "var(--dpf-border)"}`,
          borderRadius: 6,
          fontSize: 14,
        };
        return (
          <div key={field.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 500, color: "var(--dpf-text)" }}>
              {field.label}
              {field.required && <span style={{ color: "var(--dpf-error)" }} aria-hidden="true"> *</span>}
              {field.required && <span className="sr-only"> (required)</span>}
            </label>
            {field.type === "textarea" ? (
              <textarea
                id={inputId}
                name={field.name}
                required={field.required}
                rows={4}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={describedBy}
                style={{ ...commonStyle, resize: "vertical" }}
              />
            ) : field.type === "select" ? (
              <select
                id={inputId}
                name={field.name}
                required={field.required}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={describedBy}
                style={commonStyle}
              >
                <option value="">Select…</option>
                {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                id={inputId}
                type={field.type}
                name={field.name}
                required={field.required}
                placeholder={field.placeholder}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={describedBy}
                style={commonStyle}
              />
            )}
            {fieldError && (
              <span id={errorId(FORM_ID, field.name)} style={{ fontSize: 12, color: "var(--dpf-error)" }}>
                {fieldError}
              </span>
            )}
          </div>
        );
      })}

      <button
        type="submit"
        disabled={loading}
        style={{
          padding: "10px 20px", background: "var(--dpf-accent, #4f46e5)", color: "#fff",
          border: "none", borderRadius: 6, fontSize: 14, fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Sending…" : "Send Enquiry"}
      </button>
    </form>
  );
}
