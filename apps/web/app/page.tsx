// apps/web/app/page.tsx
// Landing page — choose customer portal or employee/admin workspace.
import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function RootPage() {
  // If already authenticated, redirect to the right place
  const session = await auth();
  if (session?.user) {
    if (session.user.type === "customer") redirect("/portal");
    redirect("/workspace");
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
      <div style={{ textAlign: "center", maxWidth: 500 }}>
        <h1 style={{ color: "#fff", fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
          Digital Product Factory
        </h1>
        <p style={{ color: "#8888a0", fontSize: 14, marginBottom: 40 }}>
          Choose how you'd like to sign in
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Customer Portal */}
          <Link
            href="/customer-login"
            style={{
              display: "block",
              padding: "28px 20px",
              background: "#1a1a2e",
              border: "1px solid #2a2a40",
              borderTop: "3px solid #7c8cf8",
              borderRadius: 10,
              textDecoration: "none",
              transition: "border-color 0.15s",
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>&#x1F465;</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 6 }}>
              Customer Portal
            </div>
            <div style={{ fontSize: 12, color: "#8888a0", lineHeight: 1.5 }}>
              Access your account, orders, services, and support
            </div>
          </Link>

          {/* Employee / Admin */}
          <Link
            href="/login"
            style={{
              display: "block",
              padding: "28px 20px",
              background: "#1a1a2e",
              border: "1px solid #2a2a40",
              borderTop: "3px solid #4ade80",
              borderRadius: 10,
              textDecoration: "none",
              transition: "border-color 0.15s",
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>&#x1F3E2;</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 6 }}>
              Employee & Admin
            </div>
            <div style={{ fontSize: 12, color: "#8888a0", lineHeight: 1.5 }}>
              Workforce management, operations, and platform administration
            </div>
          </Link>
        </div>

        <div style={{ marginTop: 32 }}>
          <Link
            href="/customer-signup"
            style={{ color: "#7c8cf8", fontSize: 13, textDecoration: "none" }}
          >
            New customer? Create an account →
          </Link>
        </div>
      </div>
    </div>
  );
}
