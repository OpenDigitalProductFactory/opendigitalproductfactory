// apps/web/app/(shell)/delivery/page.tsx
//
// BI-ARCH-DELIVERY-IA: one operator home for delivery work. This is a HUB — it
// launches the existing delivery surfaces; it does not own a second tracking or
// timeline model (work tracking + evidence live in change lanes / the unified
// tracking work of EP-UNIFIED-TRACKING). Every link points at a route that
// already exists, so all deep links are preserved.
import Link from "next/link";

export const dynamic = "force-dynamic";

type DeliveryLink = { label: string; href: string; description: string };

const GROUPS: Array<{ title: string; blurb: string; items: DeliveryLink[] }> = [
  {
    title: "Build & ship",
    blurb: "Compose and deliver new capability.",
    items: [
      { label: "Build Studio", href: "/build", description: "Create and ship new capability with AI help." },
      { label: "Work control", href: "/build/work", description: "Workrooms across every surface and agent." },
    ],
  },
  {
    title: "Plan",
    blurb: "Decide what gets built next.",
    items: [
      { label: "Backlog", href: "/ops", description: "Cross-cutting work queues and improvements." },
    ],
  },
  {
    title: "Track & release",
    blurb: "Follow work to production.",
    items: [
      {
        label: "Change lanes",
        href: "/platform/development/change-lanes",
        description: "Active work + evidence across Claude, Codex, and Build Studio.",
      },
      { label: "Promotions", href: "/ops/promotions", description: "Release orchestration and readiness." },
      { label: "Dev loop", href: "/ops/dev-loop", description: "Build-runtime worktrees, sandboxes, and leases." },
      { label: "Self-upgrade", href: "/ops/self-upgrade", description: "Governed portal image lifecycle and health." },
    ],
  },
];

export default function DeliveryHome() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6" data-component="delivery-home">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-[var(--dpf-text)]">Delivery</h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Build, ship, and track delivery work from one operator home. Model and provider
          configuration stays under Platform.
        </p>
      </header>

      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{group.title}</h2>
            <p className="text-xs text-[var(--dpf-muted)]">{group.blurb}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col gap-1 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 transition-colors hover:border-[var(--dpf-accent)]"
              >
                <span className="text-sm font-medium text-[var(--dpf-text)]">{item.label}</span>
                <span className="text-xs text-[var(--dpf-muted)]">{item.description}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
