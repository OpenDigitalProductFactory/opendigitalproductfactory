"use client";

import { useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SocialButtons, SocialDivider } from "@/components/social-buttons";

export function CustomerLoginForm({ socialEnabled }: { socialEnabled: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await signIn("customer", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError("Invalid email or password");
      } else {
        router.push("/portal");
      }
    });
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--dpf-bg)",
      padding: 20,
    }}>
      <div style={{
        width: 380,
        maxWidth: "100%",
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 12,
        padding: 32,
      }}>
        <h1 style={{ color: "var(--dpf-text)", fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
          Customer Portal
        </h1>
        <p style={{ color: "var(--dpf-muted)", fontSize: 13, marginBottom: 24 }}>
          Sign in to your account
        </p>

        {socialEnabled && (
          <>
            <SocialButtons />
            <SocialDivider />
          </>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", color: "var(--dpf-muted)", fontSize: 12, marginBottom: 4 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 14,
                borderRadius: 6,
                border: "1px solid var(--dpf-border)",
                background: "var(--dpf-bg)",
                color: "var(--dpf-text)",
                outline: "none",
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", color: "var(--dpf-muted)", fontSize: 12, marginBottom: 4 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 14,
                borderRadius: 6,
                border: "1px solid var(--dpf-border)",
                background: "var(--dpf-bg)",
                color: "var(--dpf-text)",
                outline: "none",
              }}
            />
          </div>

          {error && (
            <p style={{ color: "#ef4444", fontSize: 12, marginBottom: 12 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={isPending}
            style={{
              width: "100%",
              padding: "10px 0",
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 6,
              border: "none",
              background: "var(--dpf-accent)",
              color: "var(--dpf-text)",
              cursor: isPending ? "wait" : "pointer",
              opacity: isPending ? 0.7 : 1,
            }}
          >
            {isPending ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: "center", fontSize: 12, color: "var(--dpf-muted)" }}>
          <span>Don&apos;t have an account? </span>
          <Link href="/customer-signup" style={{ color: "var(--dpf-accent)", textDecoration: "none" }}>
            Sign up
          </Link>
        </div>

        <div style={{ marginTop: 8, textAlign: "center", fontSize: 12 }}>
          <Link href="/login" style={{ color: "var(--dpf-muted)", textDecoration: "none" }}>
            Staff login →
          </Link>
        </div>
      </div>
    </div>
  );
}
