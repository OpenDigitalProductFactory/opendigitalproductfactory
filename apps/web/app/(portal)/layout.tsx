// apps/web/app/(portal)/layout.tsx
// Customer portal shell — separate from admin (shell) layout.
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/portal" },
  { label: "Orders", href: "/portal/orders" },
  { label: "Services", href: "/portal/services" },
  { label: "Support", href: "/portal/support" },
];

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.type !== "customer") redirect("/");

  const user = session.user;

  return (
    <div style={{ minHeight: "100vh", background: "#0d0d18", color: "#e0e0ff" }}>
      {/* Portal header */}
      <header style={{
        background: "#1a1a2e",
        borderBottom: "1px solid #2a2a40",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 56,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <Link href="/portal" style={{ color: "#7c8cf8", fontWeight: 700, fontSize: 16, textDecoration: "none" }}>
            Portal
          </Link>
          <nav style={{ display: "flex", gap: 4 }}>
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: "6px 12px",
                  fontSize: 13,
                  color: "#b0b0c8",
                  textDecoration: "none",
                  borderRadius: 4,
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: "#e0e0ff" }}>{user.accountName}</div>
            <div style={{ fontSize: 10, color: "#8888a0" }}>{user.email}</div>
          </div>
          <form action={async () => {
            "use server";
            const { signOut } = await import("@/lib/auth");
            await signOut({ redirectTo: "/customer-login" });
          }}>
            <button
              type="submit"
              style={{
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 4,
                border: "1px solid #2a2a40",
                background: "transparent",
                color: "#8888a0",
                cursor: "pointer",
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* Portal content */}
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px" }}>
        {children}
      </main>
    </div>
  );
}
