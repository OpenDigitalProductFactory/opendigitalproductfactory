import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { getSkillCatalog, getSkillCatalogStats } from "@/lib/actions/skill-marketplace";
import { SkillsCatalogView } from "@/components/admin/SkillsCatalogView";

export default async function AdminSkillsPage() {
  const [skills, stats] = await Promise.all([
    getSkillCatalog(),
    getSkillCatalogStats(),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Skills Catalog — {stats.total} skill{stats.total !== 1 ? "s" : ""}
        </p>
      </div>

      <AdminTabNav />

      {/* Conceptual distinction: Prompts vs Skills */}
      <div className="mb-6 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h3 className="mb-2 text-xs font-semibold text-[var(--dpf-text)]">
          Prompts vs Skills
        </h3>
        <div className="grid gap-3 text-xs text-[var(--dpf-muted)] sm:grid-cols-2">
          <div>
            <span className="font-medium text-[var(--dpf-text)]">Prompts</span>{" "}
            are system instructions that shape how a coworker thinks — its
            persona, heuristics, and interpretive model. Managed on the{" "}
            <a href="/admin/prompts" className="underline text-[var(--dpf-accent)]">
              Prompts
            </a>{" "}
            tab.
          </div>
          <div>
            <span className="font-medium text-[var(--dpf-text)]">Skills</span>{" "}
            are user-triggerable actions with capability gates and tool access.
            They appear in the coworker skills dropdown and can be assigned to
            specific agents. Defined via <code className="text-[10px]">.skill.md</code> files
            and seeded to this catalog.
          </div>
        </div>
        {stats.total === 0 && (
          <p className="mt-3 text-xs text-[var(--dpf-muted)]">
            Built-in coworker actions (e.g. &ldquo;Start a feature&rdquo;,
            &ldquo;Health summary&rdquo;) are currently loaded from route
            configuration. Skills added here will be merged into the coworker
            dropdown alongside those defaults.
          </p>
        )}
      </div>

      <SkillsCatalogView
        skills={JSON.parse(JSON.stringify(skills))}
        stats={JSON.parse(JSON.stringify(stats))}
      />
    </div>
  );
}
