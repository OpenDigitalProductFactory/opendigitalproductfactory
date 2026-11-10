// Consolidated proactivity confirm/adjust view (BI-65D622EA). Lives under the
// coworker-decisions governance hub — no new top-level navigation. Server
// component; reuses the roster query, the batched override read, the pure
// resolver projection, and the shared adjust control. Spec:
// docs/superpowers/specs/2026-07-17-needs-you-cognitive-load-redesign-design.md
// (deferred surface: proactivity confirm/adjust).

import Link from "next/link";
import { redirect } from "next/navigation";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import {
  deriveProactivityRoster,
  type ProactivityRosterAgent,
} from "@/lib/proactivity/proactivity-roster";
import { collapseDualSeedDuplicates } from "@/lib/coworker-record/selectable-coworker";
import { ProactivityRosterList } from "@/components/proactivity/ProactivityRosterList";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Coworker proactivity",
};

export default async function CoworkerProactivityPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const agents = await prisma.agent.findMany({
    where: { archived: false },
    orderBy: [{ tier: "asc" }, { name: "asc" }],
    select: {
      agentId: true,
      name: true,
      displayName: true,
      role: true,
      kind: true,
      portfolio: { select: { slug: true } },
    },
  });
  // One coworker seeded under both its slug and its canonical AGT-* id is ONE
  // coworker, not two proactivity settings to reconcile (BI-74FD6420).
  const roster: ProactivityRosterAgent[] = collapseDualSeedDuplicates(agents).map((agent) => ({
    agentId: agent.agentId,
    displayName: agent.displayName || agent.name,
    role: agent.role ?? agent.kind,
    portfolioSlug: agent.portfolio?.slug ?? null,
  }));
  const rows = deriveProactivityRoster(roster);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <nav className="mb-4 text-sm text-[var(--dpf-muted)]">
        <Link href="/coworker-decisions" className="hover:text-[var(--dpf-text)]">
          Coworker Decision Engine
        </Link>
        <span className="mx-2">/</span>
        <span className="text-[var(--dpf-text)]">Proactivity</span>
      </nav>

      <header className="mb-5">
        <h1 className="mb-1 text-2xl font-semibold text-[var(--dpf-text)]">
          How much each coworker acts on its own
        </h1>
        <p className="max-w-prose text-sm text-[var(--dpf-muted)]">
          These levels were set from your industry&rsquo;s risk posture, so you didn&rsquo;t start
          from scratch. Confirm them, or change any coworker. A more assertive setting lets a
          coworker handle routine work and only tell you after; a more reactive setting asks you
          first.
        </p>
        <p className="mt-2 max-w-prose text-xs text-[var(--dpf-muted)]">
          Two things always come to you no matter the setting: money leaving the business, and
          anything that goes public.
        </p>
      </header>

      <ProactivityRosterList rows={rows} />
    </div>
  );
}
