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
          Skills Marketplace — {stats.total} skill{stats.total !== 1 ? "s" : ""}
        </p>
      </div>

      <AdminTabNav />

      <SkillsCatalogView
        skills={JSON.parse(JSON.stringify(skills))}
        stats={JSON.parse(JSON.stringify(stats))}
      />
    </div>
  );
}
