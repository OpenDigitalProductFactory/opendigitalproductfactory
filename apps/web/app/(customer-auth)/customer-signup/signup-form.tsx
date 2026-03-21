"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { customerSignup } from "@/lib/actions/customer-auth";
import { SocialButtons, SocialDivider } from "@/components/social-buttons";

export function CustomerSignupForm({ socialEnabled }: { socialEnabled: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    startTransition(async () => {
      const result = await customerSignup({
        email: email.trim(),
        password,
        companyName: companyName.trim(),
      });
      if (result.success) {
        router.push("/customer-login?registered=true");
      } else {
        setError(result.error ?? "Signup failed");
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
          Create Account
        </h1>
        <p style={{ color: "var(--dpf-muted)", fontSize: 13, marginBottom: 24 }}>
          Sign up for the customer portal
        </p>

        {socialEnabled && (
          <>
            <SocialButtons />
            <SocialDivider />
          </>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", color: "var(--dpf-muted)", fontSize: 12, marginBottom: 4 }}>Company Name</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              autoFocus
              placeholder="Your company or organization"
              style={{
                width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 6,
                border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)", outline: "none",
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", color: "var(--dpf-muted)", fontSize: 12, marginBottom: 4 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
              style={{
                width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 6,
                border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)", outline: "none",
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", color: "var(--dpf-muted)", fontSize: 12, marginBottom: 4 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="At least 8 characters"
              style={{
                width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 6,
                border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)", outline: "none",
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", color: "var(--dpf-muted)", fontSize: 12, marginBottom: 4 }}>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              style={{
                width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 6,
                border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)", outline: "none",
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
              width: "100%", padding: "10px 0", fontSize: 14, fontWeight: 600, borderRadius: 6,
              border: "none", background: "var(--dpf-accent)", color: "#fff",
              cursor: isPending ? "wait" : "pointer", opacity: isPending ? 0.7 : 1,
            }}
          >
            {isPending ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: "center", fontSize: 12, color: "var(--dpf-muted)" }}>
          <span>Already have an account? </span>
          <Link href="/customer-login" style={{ color: "var(--dpf-accent)", textDecoration: "none" }}>
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
