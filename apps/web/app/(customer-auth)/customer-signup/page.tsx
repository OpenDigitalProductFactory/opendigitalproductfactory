// apps/web/app/(customer-auth)/customer-signup/page.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { customerSignup } from "@/lib/actions/customer-auth";

export default function CustomerSignupPage() {
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
          Create Account
        </h1>
        <p style={{ color: "#8888a0", fontSize: 13, marginBottom: 24 }}>
          Sign up for the customer portal
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", color: "#b0b0c8", fontSize: 12, marginBottom: 4 }}>Company Name</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              autoFocus
              placeholder="Your company or organization"
              style={{
                width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 6,
                border: "1px solid #2a2a40", background: "#0d0d18", color: "#fff", outline: "none",
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", color: "#b0b0c8", fontSize: 12, marginBottom: 4 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
              style={{
                width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 6,
                border: "1px solid #2a2a40", background: "#0d0d18", color: "#fff", outline: "none",
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", color: "#b0b0c8", fontSize: 12, marginBottom: 4 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="At least 8 characters"
              style={{
                width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 6,
                border: "1px solid #2a2a40", background: "#0d0d18", color: "#fff", outline: "none",
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", color: "#b0b0c8", fontSize: 12, marginBottom: 4 }}>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              style={{
                width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 6,
                border: "1px solid #2a2a40", background: "#0d0d18", color: "#fff", outline: "none",
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
              border: "none", background: "#7c8cf8", color: "#fff",
              cursor: isPending ? "wait" : "pointer", opacity: isPending ? 0.7 : 1,
            }}
          >
            {isPending ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: "center", fontSize: 12, color: "#8888a0" }}>
          <span>Already have an account? </span>
          <Link href="/customer-login" style={{ color: "#7c8cf8", textDecoration: "none" }}>
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
