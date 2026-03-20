"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

type Step = "email" | "password" | "employee_redirect" | "signup_prompt";

export function SignInForm({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/storefront/detect-email?email=${encodeURIComponent(email)}`);
    const { type } = await res.json() as { type: string };

    if (type === "customer") setStep("password");
    else if (type === "employee") setStep("employee_redirect");
    else setStep("signup_prompt");

    setLoading(false);
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signIn("customer", { email, password, redirect: false });
    if (result?.error) {
      setError("Incorrect password. Please try again.");
      setLoading(false);
      return;
    }
    router.push("/portal");
  }

  if (step === "employee_redirect") {
    return (
      <div style={{ textAlign: "center", padding: "40px 0" }}>
        <p style={{ marginBottom: 16, color: "#374151" }}>
          {email} is a staff account. Please use the employee login.
        </p>
        <a href={`/login`}
          style={{ color: "var(--dpf-accent, #4f46e5)", fontWeight: 600 }}>
          Go to employee login
        </a>
      </div>
    );
  }

  if (step === "signup_prompt") {
    return (
      <div style={{ textAlign: "center", padding: "40px 0" }}>
        <p style={{ marginBottom: 16, color: "#374151" }}>No account found for {email}.</p>
        <a href={`/s/${orgSlug}/sign-up?email=${encodeURIComponent(email)}`}
          style={{ padding: "10px 20px", background: "var(--dpf-accent, #4f46e5)", color: "#fff", borderRadius: 6, textDecoration: "none", fontWeight: 600 }}>
          Create an account
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={step === "email" ? handleEmailSubmit : handlePasswordSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 360 }}>
      {error && <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 13, fontWeight: 500 }}>Email address</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
          disabled={step === "password"}
          style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }} />
      </div>
      {step === "password" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
            style={{ padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14 }} />
        </div>
      )}
      <button type="submit" disabled={loading}
        style={{ padding: "10px 20px", background: "var(--dpf-accent, #4f46e5)", color: "#fff", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
        {loading ? "…" : step === "email" ? "Continue" : "Sign in"}
      </button>
    </form>
  );
}
