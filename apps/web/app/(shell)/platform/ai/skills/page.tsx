// apps/web/app/(shell)/platform/ai/skills/page.tsx
// TAK Skills Observatory — admin visibility into specialist capabilities.
import { AiTabNav } from "@/components/platform/AiTabNav";
import { SkillsObservatoryPanel } from "@/components/platform/SkillsObservatoryPanel";
import {
  getSkillsCatalog,
  getFinishingPassActivity,
  getSpecialistExecutions,
  getSkillsObservatoryStats,
} from "@/lib/actions/skills-observatory";

export default async function SkillsObservatoryPage() {
  const [skills, finishingPasses, executions, stats] = await Promise.all([
    getSkillsCatalog(),
    getFinishingPassActivity(),
    getSpecialistExecutions(),
    getSkillsObservatoryStats(),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">AI Workforce</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          TAK Skills Observatory — {stats.totalSkills} skills across {stats.routes} routes
        </p>
      </div>

      <AiTabNav />

      <SkillsObservatoryPanel
        skills={skills}
        finishingPasses={JSON.parse(JSON.stringify(finishingPasses))}
        specialistExecutions={JSON.parse(JSON.stringify(executions))}
        stats={stats}
      />
    </div>
  );
}
