"use client";

import { useState, useEffect, useRef, useId } from "react";
import { submitInquiry } from "@/lib/storefront-actions";
import { useRouter } from "next/navigation";
import {
  validateRequiredFields,
  orderedErrors,
  type FieldErrors,
  type FieldValues,
} from "@/lib/storefront/inquiry-validation";

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
  const fieldIdPrefix = useId();
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [calcSnapshot, setCalcSnapshot] = useState<Record<string, unknown> | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("dpf_calc_snapshot");
    if (raw) {
      try { setCalcSnapshot(JSON.parse(raw)); } catch { /* ignore malformed */ }
    }
  }, []);

  const fieldDomId = (name: string) => `${fieldIdPrefix}-${name}`;
  const errorDomId = (name: string) => `${fieldIdPrefix}-${name}-error`;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);

    const fd = new FormData(e.currentTarget);
    const values: FieldValues = {};
    for (const field of formSchema) {
      values[field.name] = fd.get(field.name) as string | null;
    }

    // Visible, accessible validation runs BEFORE any server call so an empty or
    // invalid submit produces inline + summary feedback and no side effect —
    // never a silent browser-native popup.
    const errors = validateRequiredFields(formSchema, values);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      // Move focus to the summary so screen-reader and keyboard users are taken
      // straight to the list of problems.
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setFieldErrors({});
    setLoading(true);

    const email = values.email ?? "";
    const name = values.name ?? "";
    const phone = (values.phone as string | null) ?? undefined;
    // Archetype schemas use a "notes" textarea for free-text; the generic schema
    // uses "message". Treat either as the inquiry message.
    const message = (values.message ?? values.notes ?? undefined) as string | undefined;

    const formData: Record<string, unknown> = {};
    for (const field of formSchema) {
      if (!["name", "email", "phone", "notes", "message"].includes(field.name)) {
        const val = fd.get(field.name);
        if (val !== null) formData[field.name] = val;
      }
    }

    if (calcSnapshot) formData.calculatorSnapshot = calcSnapshot;

    const result = await submitInquiry(orgSlug, {
      customerEmail: email,
      customerName: name,
      customerPhone: phone || undefined,
      message: message || undefined,
      itemId,
      formData: Object.keys(formData).length > 0 ? formData : undefined,
    });

    if (!result.success) {
      setSubmitError(result.error);
      setLoading(false);
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }

    router.push(`/s/${orgSlug}/inquiry/received?ref=${encodeURIComponent(result.ref)}`);
  }

  const summaryErrors = orderedErrors(formSchema, fieldErrors);
  const hasSummary = summaryErrors.length > 0 || submitError !== null;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}
    >
      {hasSummary && (
        <div
          ref={summaryRef}
          role="alert"
          tabIndex={-1}
          style={{
            border: "1px solid var(--dpf-error)",
            background: "color-mix(in srgb, var(--dpf-error) 8%, transparent)",
            borderRadius: 8,
            padding: "12px 14px",
            fontSize: 13,
            color: "var(--dpf-error)",
            outline: "none",
          }}
        >
          {submitError ? (
            <span>{submitError}</span>
          ) : (
            <>
              <strong style={{ display: "block", marginBottom: 6 }}>
                {`Please fix ${summaryErrors.length} ${summaryErrors.length === 1 ? "field" : "fields"} before sending:`}
              </strong>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {summaryErrors.map((err) => (
                  <li key={err.name}>
                    <a
                      href={`#${fieldDomId(err.name)}`}
                      style={{ color: "var(--dpf-error)", textDecoration: "underline" }}
                    >
                      {err.message}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {formSchema.map((field) => {
        const id = fieldDomId(field.name);
        const error = fieldErrors[field.name];
        const describedBy = error ? errorDomId(field.name) : undefined;
        const commonStyle = {
          padding: "8px 12px",
          border: `1px solid ${error ? "var(--dpf-error)" : "var(--dpf-border)"}`,
          borderRadius: 6,
          fontSize: 14,
        } as const;
        return (
          <div key={field.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label htmlFor={id} style={{ fontSize: 13, fontWeight: 500, color: "var(--dpf-text)" }}>
              {field.label}
              {field.required && (
                <span style={{ color: "var(--dpf-error)" }} aria-hidden="true"> *</span>
              )}
              {field.required && <span className="sr-only"> (required)</span>}
            </label>
            {field.type === "textarea" ? (
              <textarea
                id={id}
                name={field.name}
                required={field.required}
                aria-required={field.required}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy}
                rows={4}
                style={{ ...commonStyle, resize: "vertical" }}
              />
            ) : field.type === "select" ? (
              <select
                id={id}
                name={field.name}
                required={field.required}
                aria-required={field.required}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy}
                style={commonStyle}
              >
                <option value="">Select…</option>
                {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                id={id}
                type={field.type}
                name={field.name}
                required={field.required}
                aria-required={field.required}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy}
                placeholder={field.placeholder}
                style={commonStyle}
              />
            )}
            {error && (
              <span id={errorDomId(field.name)} style={{ fontSize: 12, color: "var(--dpf-error)" }}>
                {error}
              </span>
            )}
          </div>
        );
      })}
      <button type="submit" disabled={loading}
        style={{
          padding: "10px 20px", background: "var(--dpf-accent, #4f46e5)", color: "#fff",
          border: "none", borderRadius: 6, fontSize: 14, fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer",
        }}>
        {loading ? "Sending…" : "Send Enquiry"}
      </button>
    </form>
  );
}
