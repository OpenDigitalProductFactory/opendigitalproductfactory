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
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d0d18", padding: 20 }}>
        <div style={{ color: "#ef4444", textAlign: "center" }}>
          <p>Invalid or expired link. Please try signing in again.</p>
          <Link href={`/s/${slug}/sign-in`} style={{ color: "#7c8cf8" }}>Back to login</Link>
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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d0d18", padding: 20 }}>
      <div style={{ width: 380, maxWidth: "100%", background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: 12, padding: 32 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#1e3a5f", margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            🔗
          </div>
          <h1 style={{ color: "#fff", fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            Link Your Account
          </h1>
          <p style={{ color: "#8888a0", fontSize: 13, lineHeight: 1.5 }}>
            We found an existing account with your email. Enter your password to link your social sign-in.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", color: "#b0b0c8", fontSize: 12, marginBottom: 4 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              style={{ width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 6, border: "1px solid #2a2a40", background: "#0d0d18", color: "#fff", outline: "none" }}
            />
          </div>

          {error && (
            <p style={{ color: "#ef4444", fontSize: 12, marginBottom: 12 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={isPending || attempts >= 5}
            style={{ width: "100%", padding: "10px 0", fontSize: 14, fontWeight: 600, borderRadius: 6, border: "none", background: "#7c8cf8", color: "#fff", cursor: isPending ? "wait" : "pointer", opacity: isPending ? 0.7 : 1 }}
          >
            {isPending ? "Linking..." : "Link Account & Sign In"}
          </button>
        </form>

        <div style={{ marginTop: 16, textAlign: "center", fontSize: 12 }}>
          <Link href={`/s/${slug}/sign-in`} style={{ color: "#8888a0", textDecoration: "none" }}>
            Not your account? Sign in differently
          </Link>
        </div>
      </div>
    </div>
  );
}
