import Link from "next/link";
import { SkillsCatalogView } from "@/components/admin/SkillsCatalogView";
import { SkillsObservatoryPanel } from "@/components/platform/SkillsObservatoryPanel";
import {
  getSkillCatalog,
  getSkillCatalogStats,
} from "@/lib/actions/skill-marketplace";
import {
  getSkillsCatalog,
  getFinishingPassActivity,
  getSpecialistExecutions,
  getSkillsObservatoryStats,
} from "@/lib/actions/skills-observatory";

export default async function SkillsObservatoryPage() {
  const [catalogSkills, catalogStats, skills, finishingPasses, executions, stats] = await Promise.all([
    getSkillCatalog(),
    getSkillCatalogStats(),
    getSkillsCatalog(),
    getFinishingPassActivity(),
    getSpecialistExecutions(),
    getSkillsObservatoryStats(),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">AI Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Skills — {catalogStats.total} catalog entries and {stats.totalSkills} route-visible skills across {stats.routes} routes
        </p>
      </div>

      <div className="mb-6 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h2 className="mb-2 text-sm font-semibold text-[var(--dpf-text)]">Catalog</h2>
        <p className="mb-3 text-xs text-[var(--dpf-muted)]">
          Skills are user-triggerable or agent-triggerable actions with capability gates and tool access.
          Prompts remain the system instructions that shape coworker behavior and now live under{" "}
          <Link href="/platform/ai/prompts" className="underline text-[var(--dpf-accent)]">
            Prompts
          </Link>.
        </p>
        <SkillsCatalogView
          skills={JSON.parse(JSON.stringify(catalogSkills))}
          stats={JSON.parse(JSON.stringify(catalogStats))}
        />
      </div>

      <div className="mb-6 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h2 className="mb-2 text-sm font-semibold text-[var(--dpf-text)]">Route Skills</h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          Route-level and universal skills describe what coworkers can surface in-context across the platform.
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--dpf-text)]">Observability</h2>
        <SkillsObservatoryPanel
          skills={skills}
          finishingPasses={JSON.parse(JSON.stringify(finishingPasses))}
          specialistExecutions={JSON.parse(JSON.stringify(executions))}
          stats={stats}
        />
      </div>
    </div>
  );
}
