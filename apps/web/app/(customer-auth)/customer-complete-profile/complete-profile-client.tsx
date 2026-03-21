"use client";

import { useState, useTransition, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { completeProfileWithSocial } from "@/lib/actions/social-auth-actions";
import { validateInviteCode } from "@/lib/actions/invite-actions";

type Tab = "create" | "join";

export function CompleteProfileClient({ slug }: { slug: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("create");
  const [companyName, setCompanyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [invitePreview, setInvitePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "join" || inviteCode.trim().length < 6) {
      setInvitePreview(null);
      return;
    }
    const timeout = setTimeout(async () => {
      const result = await validateInviteCode(inviteCode.trim());
      if (result.valid && result.account) {
        setInvitePreview(result.account.name);
      } else {
        setInvitePreview(null);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [inviteCode, tab]);

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
    setError(null);
    startTransition(async () => {
      const input = tab === "create"
        ? { mode: "create" as const, companyName: companyName.trim() }
        : { mode: "join" as const, inviteCode: inviteCode.trim() };
      const result = await completeProfileWithSocial(token!, input);
      if (result.success) {
        router.push(`/s/${slug}/sign-in`);
      } else {
        setError(result.error ?? "Failed to complete setup");
      }
    });
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "8px 0",
    textAlign: "center",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    background: active ? "#7c8cf8" : "#0d0d18",
    color: active ? "#fff" : "#8888a0",
    border: "none",
  });

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--dpf-bg)", padding: 20 }}>
      <div style={{ width: 380, maxWidth: "100%", background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", borderRadius: 12, padding: 32 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h1 style={{ color: "var(--dpf-text)", fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Welcome!</h1>
          <p style={{ color: "var(--dpf-muted)", fontSize: 13 }}>Complete your profile to get started</p>
        </div>

        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid var(--dpf-border)", marginBottom: 16 }}>
          <button type="button" onClick={() => setTab("create")} style={tabStyle(tab === "create")}>Create Company</button>
          <button type="button" onClick={() => setTab("join")} style={tabStyle(tab === "join")}>Join with Invite Code</button>
        </div>

        <form onSubmit={handleSubmit}>
          {tab === "create" && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", color: "var(--dpf-muted)", fontSize: 12, marginBottom: 4 }}>Company Name</label>
              <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required autoFocus placeholder="Acme Corp"
                style={{ width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 6, border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)", outline: "none" }} />
            </div>
          )}
          {tab === "join" && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", color: "var(--dpf-muted)", fontSize: 12, marginBottom: 4 }}>Invite Code</label>
              <input type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} required autoFocus placeholder="ACME-7K3X"
                style={{ width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 6, border: "1px solid var(--dpf-border)", background: "var(--dpf-bg)", color: "var(--dpf-text)", outline: "none", fontFamily: "monospace" }} />
              {invitePreview && <p style={{ color: "#34d399", fontSize: 12, marginTop: 4 }}>Joining: {invitePreview}</p>}
            </div>
          )}
          {error && <p style={{ color: "#ef4444", fontSize: 12, marginBottom: 12 }}>{error}</p>}
          <button type="submit" disabled={isPending}
            style={{ width: "100%", padding: "10px 0", fontSize: 14, fontWeight: 600, borderRadius: 6, border: "none", background: "var(--dpf-accent)", color: "#fff", cursor: isPending ? "wait" : "pointer", opacity: isPending ? 0.7 : 1 }}>
            {isPending ? "Setting up..." : "Complete Setup"}
          </button>
        </form>

        <div style={{ marginTop: 16, textAlign: "center", fontSize: 12 }}>
          <Link href={`/s/${slug}/sign-in`} style={{ color: "var(--dpf-muted)", textDecoration: "none" }}>Back to login</Link>
        </div>
      </div>
    </div>
  );
}
