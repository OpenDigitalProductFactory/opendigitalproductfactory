"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export function SignUpForm({
  orgSlug,
  prefillEmail,
}: {
  orgSlug: string;
  prefillEmail?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(prefillEmail ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/storefront/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, orgSlug }),
    });

    if (!res.ok) {
      const data = await res.json() as { error?: string };
      setError(data.error ?? "Sign-up failed. Please try again.");
      setLoading(false);
      return;
    }

    // Sign in immediately after successful registration
    const result = await signIn("customer", { email, password, redirect: false });
    if (result?.error) {
      setError("Account created but sign-in failed. Please sign in manually.");
      setLoading(false);
      return;
    }

    router.push("/portal");
  }

  return (
    <form onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 360 }}>
      {error && <div style={{ color: "var(--dpf-error)", fontSize: 13 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 13, fontWeight: 500 }}>Full name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          style={{ padding: "8px 12px", border: "1px solid var(--dpf-border)", borderRadius: 6, fontSize: 14 }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 13, fontWeight: 500 }}>Email address</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ padding: "8px 12px", border: "1px solid var(--dpf-border)", borderRadius: 6, fontSize: 14 }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 13, fontWeight: 500 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ padding: "8px 12px", border: "1px solid var(--dpf-border)", borderRadius: 6, fontSize: 14 }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 13, fontWeight: 500 }}>Confirm password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          style={{ padding: "8px 12px", border: "1px solid var(--dpf-border)", borderRadius: 6, fontSize: 14 }}
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        style={{ padding: "10px 20px", background: "var(--dpf-accent, #4f46e5)", color: "var(--dpf-text)", border: "none", borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
        {loading ? "…" : "Create account"}
      </button>
      <p style={{ fontSize: 13, color: "var(--dpf-muted)", textAlign: "center" }}>
        Already have an account?{" "}
        <a href={`/s/${orgSlug}/sign-in`} style={{ color: "var(--dpf-accent, #4f46e5)", fontWeight: 500 }}>
          Sign in
        </a>
      </p>
    </form>
  );
}
