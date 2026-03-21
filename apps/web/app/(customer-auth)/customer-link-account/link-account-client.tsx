"use client";

import { useState, useTransition } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { linkSocialIdentity } from "@/lib/actions/social-auth-actions";

export function LinkAccountClient({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const [isPending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  if (!token) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--dpf-bg)", padding: 20 }}>
        <div style={{ color: "#ef4444", textAlign: "center" }}>
          <p>Invalid or expired link. Please try signing in again.</p>
          <Link href={`/s/${slug}/sign-in`} style={{ color: "var(--dpf-accent)" }}>Back to login</Link>
        </div>
      </div>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (attempts >= 5) {
      setError("Too many attempts. Please try signing in again.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await linkSocialIdentity(token!, password);
      if (result.success) {
        router.push(`/s/${slug}/sign-in`);
      } else {
        setAttempts((a) => a + 1);
        setError(result.error ?? "Failed to link account");
      }
    });
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--dpf-bg)", padding: 20 }}>
      <div style={{ width: 380, maxWidth: "100%", background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", borderRadius: 12, padding: 32 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--dpf-surface-2)", margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            🔗
          </div>
          <h1 style={{ color: "var(--dpf-text)", fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            Link Your Account
          </h1>
          <p style={{ color: "var(--dpf-muted)", fontSize: 13, lineHeight: 1.5 }}>
            We found an existing account with your email. Enter your password to link your social sign-in.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", color: "var(--dpf-muted)", fontSize: 12, marginBottom: 4 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              style={{ width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 6, border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)", outline: "none" }}
            />
          </div>

          {error && (
            <p style={{ color: "#ef4444", fontSize: 12, marginBottom: 12 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={isPending || attempts >= 5}
            style={{ width: "100%", padding: "10px 0", fontSize: 14, fontWeight: 600, borderRadius: 6, border: "none", background: "var(--dpf-accent)", color: "#fff", cursor: isPending ? "wait" : "pointer", opacity: isPending ? 0.7 : 1 }}
          >
            {isPending ? "Linking..." : "Link Account & Sign In"}
          </button>
        </form>

        <div style={{ marginTop: 16, textAlign: "center", fontSize: 12 }}>
          <Link href={`/s/${slug}/sign-in`} style={{ color: "var(--dpf-muted)", textDecoration: "none" }}>
            Not your account? Sign in differently
          </Link>
        </div>
      </div>
    </div>
  );
}
