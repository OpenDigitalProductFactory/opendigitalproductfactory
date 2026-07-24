// apps/web/app/welcome/page.tsx
// Landing page — choose customer portal or employee/admin workspace.
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function WelcomePage() {
  // BI-836B0304: this chooser is reached from root `/` with no session check,
  // so an already-signed-in visitor was shown "choose how you'd like to sign
  // in" instead of landing on their workspace. Bounce a valid session to its
  // home — customer type → /portal, everyone else → /workspace (the same
  // post-login target as apps/web/app/(auth)/login/page.tsx:34's redirectTo).
  // Signed-out visitors still see the chooser below.
  const session = await auth();
  if (session?.user) {
    redirect(session.user.type === "customer" ? "/portal" : "/workspace");
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
      <div style={{ textAlign: "center", maxWidth: 500 }}>
        <h1 style={{ color: "var(--dpf-text)", fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
          Digital Product Factory
        </h1>
        <p style={{ color: "var(--dpf-muted)", fontSize: 14, marginBottom: 40 }}>
          Choose how you'd like to sign in
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Link
            href="/portal/sign-in"
            style={{
              display: "block",
              padding: "28px 20px",
              background: "var(--dpf-surface-1)",
              border: "1px solid var(--dpf-border)",
              borderTop: "3px solid #7c8cf8",
              borderRadius: 10,
              textDecoration: "none",
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>&#x1F465;</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 6 }}>
              Customer Portal
            </div>
            <div style={{ fontSize: 12, color: "var(--dpf-muted)", lineHeight: 1.5 }}>
              {/* BI-EC26D09D D1: Dale dogfood found that a shop owner who wants
                  to BUILD something had no obvious door (not a "customer";
                  "Employee & Admin" sounds like HR plumbing). Picked the
                  least-disruptive option C from the BI: keep the labels,
                  clarify WHO each door is for in the subcopy. */}
              If you’re a <strong style={{ color: "var(--dpf-text)" }}>customer of this business</strong>:
              access your account, orders, services, and support.
            </div>
          </Link>

          <Link
            href="/login"
            style={{
              display: "block",
              padding: "28px 20px",
              background: "var(--dpf-surface-1)",
              border: "1px solid var(--dpf-border)",
              borderTop: "3px solid #4ade80",
              borderRadius: 10,
              textDecoration: "none",
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>&#x1F3E2;</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 6 }}>
              Employee & Admin
            </div>
            <div style={{ fontSize: 12, color: "var(--dpf-muted)", lineHeight: 1.5 }}>
              {/* BI-EC26D09D D1: clarify that this is the door for
                  builders and operators, not only HR-style admin. */}
              If you <strong style={{ color: "var(--dpf-text)" }}>run or build for this business</strong>:
              workforce, operations, platform administration, and Build Studio.
            </div>
          </Link>
        </div>

        <div style={{ marginTop: 32 }}>
          <Link
            href="/portal/sign-up"
            style={{ color: "var(--dpf-accent)", fontSize: 13, textDecoration: "none" }}
          >
            New customer? Create an account →
          </Link>
        </div>
      </div>
    </div>
  );
}
