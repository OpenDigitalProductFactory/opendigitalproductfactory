"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export function SignInForm({ orgSlug }: { orgSlug?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signIn("customer", { email, password, redirect: false });
    if (result?.error) {
      setError("Email or password not recognised. If you don't have an account, sign up below.");
      setLoading(false);
      return;
    }
    router.push("/portal");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 360 }}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>}
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
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "10px 20px",
            background: "var(--dpf-accent, #4f46e5)",
            color: "var(--dpf-text)",
            border: "none",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {loading ? "…" : "Sign in"}
        </button>
      </form>

      {/* Social auth — shown only when configured */}
      {process.env.NEXT_PUBLIC_ENABLE_SOCIAL_AUTH === "true" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ textAlign: "center", fontSize: 12, color: "var(--dpf-muted)" }}>or continue with</div>
          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl: "/portal" })}
            style={{
              padding: "10px 20px",
              border: "1px solid var(--dpf-border)",
              borderRadius: 6,
              fontSize: 14,
              cursor: "pointer",
              background: "#fff",
              color: "var(--dpf-text)",
            }}
          >
            Continue with Google
          </button>
          <button
            type="button"
            onClick={() => signIn("apple", { callbackUrl: "/portal" })}
            style={{
              padding: "10px 20px",
              border: "1px solid var(--dpf-border)",
              borderRadius: 6,
              fontSize: 14,
              cursor: "pointer",
              background: "#000",
              color: "var(--dpf-text)",
            }}
          >
            Continue with Apple
          </button>
        </div>
      )}

      <div style={{ textAlign: "center", fontSize: 12, color: "var(--dpf-muted)" }}>
        <a href={orgSlug ? `/s/${orgSlug}/sign-up` : "/portal/sign-up"} style={{ color: "var(--dpf-accent, #4f46e5)", fontWeight: 500 }}>
          Create an account
        </a>
        {" · "}
        <a href="/login" style={{ color: "var(--dpf-muted)" }}>
          Staff login
        </a>
      </div>
    </div>
  );
}
