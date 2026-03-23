"use client";

import { useState, useTransition } from "react";
import { registerForCourse } from "@/lib/actions/training";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  fontSize: 13,
  borderRadius: 6,
  border: "1px solid var(--dpf-border)",
  background: "var(--dpf-surface-1)",
  color: "var(--dpf-text)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--dpf-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 4,
};

export function RegistrationForm({ jobCode }: { jobCode: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string; registrationId?: string } | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await registerForCourse(jobCode, {
        firstName: fd.get("firstName") as string,
        lastName: fd.get("lastName") as string,
        email: fd.get("email") as string,
        phone: (fd.get("phone") as string) || undefined,
        company: (fd.get("company") as string) || undefined,
        country: (fd.get("country") as string) || undefined,
        role: (fd.get("role") as string) || undefined,
      });
      setResult(res);
    });
  }

  if (result?.ok) {
    return (
      <div style={{
        padding: 24,
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 8,
        textAlign: "center",
      }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>Registration Confirmed</div>
        <p style={{ color: "var(--dpf-text)", fontSize: 14 }}>
          Your registration ID is <strong>{result.registrationId}</strong>
        </p>
        <p style={{ color: "var(--dpf-muted)", fontSize: 13, marginTop: 8 }}>
          You will receive a confirmation email with course details and joining instructions.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{
      padding: 20,
      background: "var(--dpf-surface-1)",
      border: "1px solid var(--dpf-border)",
      borderRadius: 8,
    }}>
      {result && !result.ok && (
        <div style={{ padding: "8px 12px", marginBottom: 16, background: "#7f1d1d33", borderRadius: 6, color: "#fca5a5", fontSize: 13 }}>
          {result.message}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div>
          <label htmlFor="firstName" style={labelStyle}>First Name *</label>
          <input id="firstName" name="firstName" type="text" required style={inputStyle} />
        </div>
        <div>
          <label htmlFor="lastName" style={labelStyle}>Last Name *</label>
          <input id="lastName" name="lastName" type="text" required style={inputStyle} />
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="email" style={labelStyle}>Email *</label>
        <input id="email" name="email" type="email" required style={inputStyle} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div>
          <label htmlFor="phone" style={labelStyle}>Phone</label>
          <input id="phone" name="phone" type="tel" style={inputStyle} />
        </div>
        <div>
          <label htmlFor="country" style={labelStyle}>Country</label>
          <input id="country" name="country" type="text" style={inputStyle} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div>
          <label htmlFor="company" style={labelStyle}>Company</label>
          <input id="company" name="company" type="text" style={inputStyle} />
        </div>
        <div>
          <label htmlFor="role" style={labelStyle}>Job Role</label>
          <input id="role" name="role" type="text" style={inputStyle} />
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        style={{
          width: "100%",
          padding: "10px 16px",
          fontSize: 14,
          fontWeight: 600,
          borderRadius: 6,
          border: "none",
          background: "var(--dpf-accent)",
          color: "white",
          cursor: isPending ? "wait" : "pointer",
          opacity: isPending ? 0.7 : 1,
        }}
      >
        {isPending ? "Registering..." : "Register Now"}
      </button>
    </form>
  );
}
