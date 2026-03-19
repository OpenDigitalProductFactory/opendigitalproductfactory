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
      background: "#0d0d18",
      padding: 20,
    }}>
      <div style={{
        width: 380,
        maxWidth: "100%",
        background: "#1a1a2e",
        border: "1px solid #2a2a40",
        borderRadius: 12,
        padding: 32,
      }}>
        <h1 style={{ color: "#fff", fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
          Customer Portal
        </h1>
        <p style={{ color: "#8888a0", fontSize: 13, marginBottom: 24 }}>
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
            <label style={{ display: "block", color: "#b0b0c8", fontSize: 12, marginBottom: 4 }}>Email</label>
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
                border: "1px solid #2a2a40",
                background: "#0d0d18",
                color: "#fff",
                outline: "none",
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", color: "#b0b0c8", fontSize: 12, marginBottom: 4 }}>Password</label>
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
                border: "1px solid #2a2a40",
                background: "#0d0d18",
                color: "#fff",
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
              background: "#7c8cf8",
              color: "#fff",
              cursor: isPending ? "wait" : "pointer",
              opacity: isPending ? 0.7 : 1,
            }}
          >
            {isPending ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: "center", fontSize: 12, color: "#8888a0" }}>
          <span>Don&apos;t have an account? </span>
          <Link href="/customer-signup" style={{ color: "#7c8cf8", textDecoration: "none" }}>
            Sign up
          </Link>
        </div>

        <div style={{ marginTop: 8, textAlign: "center", fontSize: 12 }}>
          <Link href="/login" style={{ color: "#8888a0", textDecoration: "none" }}>
            Staff login →
          </Link>
        </div>
      </div>
    </div>
  );
}
