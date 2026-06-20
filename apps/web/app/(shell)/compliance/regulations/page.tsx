import { prisma } from "@dpf/db";
import Link from "next/link";
import { CreateRegulationForm } from "@/components/compliance/CreateRegulationForm";
import { RegulationLibraryPanel } from "@/components/compliance/RegulationLibraryPanel";
import {
  addRegulationApplicability,
  complianceLibraryContextLabel,
  countByComplianceLibraryScope,
  filterByComplianceLibraryScope,
  parseComplianceLibraryScope,
  resolveComplianceLibraryContext,
} from "@/lib/compliance-library";

type Props = { searchParams: Promise<{ type?: string; scope?: string }> };

export default async function RegulationsPage({ searchParams }: Props) {
  const { type, scope: rawScope } = await searchParams;
  const scope = parseComplianceLibraryScope(rawScope);
  const where: Record<string, unknown> = {};
  if (type && type !== "all") where.sourceType = type;

  const [context, regulations] = await Promise.all([
    resolveComplianceLibraryContext(),
    prisma.regulation.findMany({
      where,
      orderBy: { shortName: "asc" },
      include: { _count: { select: { obligations: true } } },
    }),
  ]);

  const classifiedRegulations = regulations.map((regulation) =>
    addRegulationApplicability(regulation, context),
  );
  const scopeCounts = countByComplianceLibraryScope(classifiedRegulations);
  const visibleRegulations = filterByComplianceLibraryScope(classifiedRegulations, scope);
  const contextLabel = complianceLibraryContextLabel(context);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Regulations</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            {visibleRegulations.length} shown - {regulations.length} registered - {contextLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/compliance/onboard" className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90">
            Onboard Regulation / Standard
          </Link>
          <CreateRegulationForm />
        </div>
      </div>

      <RegulationLibraryPanel
        rows={visibleRegulations}
        totalCount={classifiedRegulations.length}
        contextLabel={contextLabel}
        activeScope={scope}
        activeSourceType={type}
        scopeCounts={scopeCounts}
      />
    </div>
  );
}
