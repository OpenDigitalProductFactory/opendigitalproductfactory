// apps/web/app/(portal)/layout.tsx
// Customer portal shell — uses same branding pipeline as admin shell.
export const dynamic = "force-dynamic";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { buildBrandingStyleTag } from "@/lib/branding";

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

  const activeBranding = await prisma.brandingConfig.findUnique({
    where: { scope: "organization" },
    select: { logoUrlLight: true, tokens: true },
  });

  const brandingCss = buildBrandingStyleTag(activeBranding?.tokens ?? null);

  return (
    <>
      {brandingCss && <style dangerouslySetInnerHTML={{ __html: brandingCss }} />}
      <div className="min-h-screen" style={{ background: "var(--dpf-bg)", color: "var(--dpf-text)" }}>
        {/* Portal header */}
        <header
          className="flex items-center justify-between px-6"
          style={{
            background: "var(--dpf-surface-1)",
            borderBottom: "1px solid var(--dpf-border)",
            height: 56,
          }}
        >
          <div className="flex items-center gap-6">
            <Link
              href="/portal"
              className="font-bold text-base no-underline"
              style={{ color: "var(--dpf-accent)" }}
            >
              Portal
            </Link>
            <nav className="flex gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-3 py-1.5 text-[13px] no-underline rounded"
                  style={{ color: "var(--dpf-muted)" }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs" style={{ color: "var(--dpf-text)" }}>{user.accountName}</div>
              <div className="text-[10px]" style={{ color: "var(--dpf-muted)" }}>{user.email}</div>
            </div>
            <form action={async () => {
              "use server";
              const { signOut } = await import("@/lib/auth");
              await signOut({ redirectTo: "/portal/sign-in" });
            }}>
              <button
                type="submit"
                className="text-[11px] px-2.5 py-1 rounded cursor-pointer"
                style={{
                  border: "1px solid var(--dpf-border)",
                  background: "transparent",
                  color: "var(--dpf-muted)",
                }}
              >
                Sign out
              </button>
            </form>
          </div>
        </header>

        {/* Portal content */}
        <main className="max-w-[1200px] mx-auto px-6 py-6">
          {children}
        </main>
      </div>
    </>
  );
}
