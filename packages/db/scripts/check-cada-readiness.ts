/**
 * EP-ESTATE-SOVEREIGNTY Phase 1: print this install's current CADA assurance
 * posture, derived from the live local-only inference setting + BusinessContext
 * jurisdiction + DPF's structural facts, scored by the sovereignty primitive.
 *
 * Operator utility AND the functional-verification harness for the readiness
 * logic against real platform state.
 *
 * Run: cd packages/db && npx tsx scripts/check-cada-readiness.ts [--operator <ISO2>] [--target <1-4>]
 */
import { PrismaClient } from "../generated/client/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadDbEnv } from "../src/load-env";
import { computeInstallCadaReadiness, summarizeControlCoverage, type InstallSovereigntyDeclaration } from "../src/cada-readiness";
import type { CadaAssuranceLevel } from "../src/sovereignty-assessment";

loadDbEnv();
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const LOCAL_ONLY_KEY = "inference-local-only";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Best-effort ISO2 for the operating entity from coarse BusinessContext blocs. */
function deriveOperator(operatesIn: string[]): { iso2: string; note: string } {
  if (operatesIn.includes("us")) return { iso2: "US", note: "from operatesIn=[…us…]" };
  if (operatesIn.includes("uk")) return { iso2: "GB", note: "from operatesIn=[…uk…]" };
  if (operatesIn.includes("eu")) return { iso2: "DE", note: "EEA representative from operatesIn=[eu] — pass --operator <ISO2> to refine" };
  return { iso2: "ZZ", note: "unknown (no jurisdiction declared) — treated as third country; pass --operator <ISO2>" };
}

async function main() {
  const localOnlyRow = await prisma.platformConfig.findUnique({ where: { key: LOCAL_ONLY_KEY } });
  const localOnly = !!(localOnlyRow?.value && typeof localOnlyRow.value === "object" && (localOnlyRow.value as { enabled?: boolean }).enabled === true);

  const bc = await prisma.businessContext.findFirst({ orderBy: { createdAt: "asc" } });
  const operatesIn = bc?.operatesIn ?? [];
  const dataResidency = bc?.dataResidency ?? [];
  const dataInEea =
    process.argv.includes("--data-in-eea") ||
    dataResidency.includes("eu") ||
    (dataResidency.length === 0 && operatesIn.includes("eu"));

  const operatorOverride = arg("--operator");
  const derived = deriveOperator(operatesIn);
  const operatorJurisdiction = operatorOverride?.toUpperCase() ?? derived.iso2;
  const targetArg = arg("--target");
  const target = targetArg ? (Number(targetArg) as CadaAssuranceLevel) : undefined;

  const declared: InstallSovereigntyDeclaration = { operatorJurisdiction, dataInEea };
  const readiness = computeInstallCadaReadiness(declared, localOnly, target);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("CADA readiness — current install posture");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`local-only inference: ${localOnly ? "ON" : "off"}  (PlatformConfig:${LOCAL_ONLY_KEY})`);
  console.log(`operatesIn:           ${JSON.stringify(operatesIn)}`);
  console.log(`dataResidency:        ${JSON.stringify(dataResidency)}  → dataInEea=${dataInEea}`);
  console.log(`operatorJurisdiction: ${operatorJurisdiction}  (${operatorOverride ? "override" : derived.note})`);
  console.log(`\nLevel: ${readiness.assessment.level}`);
  console.log(readiness.summary);
  console.log("\nrationale:");
  for (const r of readiness.assessment.rationale) console.log(`  • ${r}`);
  if (readiness.assessment.gaps.length) {
    console.log("gaps:");
    for (const g of readiness.assessment.gaps) console.log(`  • ${g}`);
  }

  // Governance-evidence lens: CADA control implementation coverage (seed-cada-regulation.ts).
  const reg = await prisma.regulation.findUnique({ where: { regulationId: "REG-CADA-2026" }, select: { id: true } });
  if (!reg) {
    console.log("\ngovernance: CADA not registered in this install (run scripts/seed-cada-regulation.ts).");
  } else {
    const obls = await prisma.obligation.findMany({ where: { regulationId: reg.id, status: "active" }, select: { id: true } });
    const links = await prisma.controlObligationLink.findMany({
      where: { obligationId: { in: obls.map((o) => o.id) } },
      include: { control: { select: { id: true, implementationStatus: true } } },
    });
    const byId = new Map<string, { implementationStatus: string }>();
    for (const l of links) if (l.control) byId.set(l.control.id, { implementationStatus: l.control.implementationStatus });
    console.log(`\ngovernance controls: ${summarizeControlCoverage([...byId.values()]).summary}`);
  }
  console.log("═══════════════════════════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("check-cada-readiness failed:", err);
  process.exit(1);
});
