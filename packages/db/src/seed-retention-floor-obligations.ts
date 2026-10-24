import type { PrismaClient } from "../generated/client/client";
import * as crypto from "crypto";

// EP-A33A5C61 slice 6 (BI-69C29492) — express the retention floors that were
// hardcoded in apps/web/lib/operate/retention/industry-floors.ts as OBLIGATIONS
// against the regulations that already bind an install.
//
// WHY THIS EXISTS
// The four floor rows (banking 7y, professional services 7y, healthcare 6y,
// public sector 3y) were a TypeScript table keyed by a hand-maintained alias of
// `Organization.industry`. Jurisdiction never participated, and a missed alias
// silently dropped the floor to the base window. Meanwhile the compliance plane
// already scopes every regulation by archetype AND jurisdiction. Once an
// Obligation can state a retention minimum as a number
// (Obligation.retentionMinimumDays), the same floors become a QUERY over what
// actually binds this install, with the regulator cited.
//
// HOW IT ATTACHES
// This seed invents no regulation. For each floor it looks for an ACTIVE
// regulation whose applicability already names that archetype, and attaches one
// obligation to it. If the pack for an archetype is not seeded on this install,
// the floor is simply not created — and retention-floor-parity.test.ts reports
// it, rather than the platform pretending a regulator said something it did not.
//
// SAFETY
// Floors only ever lengthen (effective = max(base, floor, ...)). The legacy
// table stays in place alongside these obligations until parity is proven, so a
// gap here can never shorten a window.

function makeId(prefix: string): string {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${hex}`;
}

const YEARS_7 = 7 * 365;
const YEARS_6 = 6 * 365;
const YEARS_3 = 3 * 365;
const YEAR_1 = 365;

/**
 * One retention floor, expressed the way a regulator states it. `archetypes`
 * are the archetype ids/categories a regulation's applicability must name for
 * this floor to attach — the same values `regulationApplies` matches on.
 */
export type RetentionFloorObligationSeed = {
  /** Stable per-install reference; also the idempotency key within a regulation. */
  reference: string;
  archetypes: readonly string[];
  /**
   * The regulations this floor is actually about, best first. The floor
   * attaches to the first one this install seeds. Empty is legal and means
   * "no considered citation exists yet", which falls straight to the
   * deterministic fallback — see planRetentionFloorObligations.
   */
  preferredRegulationIds: readonly string[];
  title: string;
  description: string;
  retentionMinimumDays: number;
  /** audit | chat | telemetry. Empty means every bucket. */
  retentionFloorBuckets: readonly string[];
};

export const RETENTION_FLOOR_OBLIGATIONS: readonly RetentionFloorObligationSeed[] = [
  {
    reference: "retention/floor/banking-financial-services",
    archetypes: ["banking-financial-services", "community-bank", "credit-union"],
    // BSA/AML states the programme-record duration directly; bank supervision
    // is the fallback for an install that seeds supervision but not BSA.
    preferredRegulationIds: ["REG-US-BSA-AML", "REG-US-FDIC-CRA", "REG-US-NCUA"],
    title: "Retain audit trails and adviser correspondence for seven years",
    description:
      "Financial-services recordkeeping (BSA/AML programme records and SEC 17a-4-style correspondence rules) requires the institution to reproduce who did what, and any advice given to a customer, for seven years. In the platform that binds the audit trail and coworker conversation history: a coworker here may give financial guidance, so its transcript is correspondence.",
    retentionMinimumDays: YEARS_7,
    retentionFloorBuckets: ["audit", "chat"],
  },
  {
    reference: "retention/floor/professional-services",
    archetypes: ["professional-services"],
    preferredRegulationIds: ["REG-US-PROFESSIONAL-PRACTICE"],
    title: "Retain client-engagement records for seven years",
    description:
      "Professional-practice record norms (accounting, legal and consultancy engagement files) require the practice to reproduce the advice it gave and the basis for it for seven years after the engagement. That binds the audit trail and the coworker conversation history, which is where advice is given.",
    retentionMinimumDays: YEARS_7,
    retentionFloorBuckets: ["audit", "chat"],
  },
  {
    reference: "retention/floor/healthcare-wellness",
    archetypes: ["healthcare-wellness"],
    preferredRegulationIds: ["REG-US-CLINICAL-PRACTICE-OPS"],
    title: "Retain clinical audit trails for six years",
    description:
      "HIPAA-adjacent documentation rules require six years of retention for records of disclosures and the systems that made them. That binds the audit trail and any conversation history that can carry clinical context.",
    retentionMinimumDays: YEARS_6,
    retentionFloorBuckets: ["audit", "chat"],
  },
  {
    reference: "retention/floor/public-sector",
    archetypes: ["public-sector", "small-town-municipality", "municipal-utility"],
    // The defect that motivated preferences: five active regulations name a
    // public-sector archetype and "EPA" sorts first, so this attached to the
    // Clean Water Act. Public-records law is what the floor is about.
    preferredRegulationIds: [
      "REG-US-STATE-PUBLIC-RECORDS",
      "REG-US-STATE-OPEN-MEETINGS",
      "REG-US-STATE-MUNI-FINANCE",
    ],
    title: "Retain public records for the statutory minimum",
    description:
      "Public-records law requires a public body to retain records of its decisions and the correspondence behind them so they remain disclosable. Three years is the conservative floor the platform applies; a state schedule that is longer supersedes it and should be recorded as its own obligation.",
    retentionMinimumDays: YEARS_3,
    retentionFloorBuckets: ["audit", "chat"],
  },
  {
    reference: "retention/floor/banking-routing-telemetry",
    archetypes: ["banking-financial-services", "community-bank", "credit-union"],
    preferredRegulationIds: ["REG-US-BSA-AML", "REG-US-FDIC-CRA", "REG-US-NCUA"],
    title: "Retain inference routing and usage telemetry for one year",
    description:
      "Where a regulated institution uses automated decisioning, the record of which model saw which request must survive long enough to answer a supervisory question about a specific interaction. One year of routing and usage telemetry is the floor.",
    retentionMinimumDays: YEAR_1,
    retentionFloorBuckets: ["telemetry"],
  },
] as const;

type RegulationRow = { id: string; regulationId: string; applicability: unknown };

/** True when a regulation's applicability names any of the floor's archetypes. */
export function regulationCoversArchetypes(
  applicability: unknown,
  archetypes: readonly string[],
): boolean {
  if (!applicability || typeof applicability !== "object") return false;
  const declared = (applicability as { archetypes?: unknown }).archetypes;
  if (!Array.isArray(declared)) return false;
  return declared.some((a) => typeof a === "string" && archetypes.includes(a));
}

/** How a floor found its regulation. A fallback attachment is a weaker claim. */
export type FloorAttachmentBasis = "preferred" | "fallback";

export type FloorAttachment = {
  floor: RetentionFloorObligationSeed;
  regulation: RegulationRow;
  basis: FloorAttachmentBasis;
};

/**
 * Pick the regulation each floor attaches to. PURE, so the parity test can
 * check coverage against the seeded registry without a database.
 *
 * TWO ARMS, AND WHY (BI-0C723E18).
 * The first cut had only the deterministic arm: lowest regulationId among the
 * archetype matches. Determinism is the right property — a re-seed on a
 * different row order must attach to the same regulation — but alphabetical
 * order is the wrong way to get it, because it considers nothing about whether
 * the regulation says anything about retaining records. On a real install five
 * active regulations name a public-sector archetype, and "EPA" sorts before
 * "STATE", so the public-records floor attached to the Clean Water Act. The
 * duration was right and the citation was nonsense — and a wrong regulator is
 * worse than none, because it reads as a claim that the Clean Water Act imposes
 * a records-retention minimum on chat transcripts.
 *
 * So a floor now NAMES the regulations it means, best first. The alphabetical
 * pick survives only as the fallback for an install that seeds none of them,
 * and the basis is reported so a fallback attachment can be seen for the weaker
 * claim it is.
 */
export function planRetentionFloorObligations(
  regulations: readonly RegulationRow[],
  floors: readonly RetentionFloorObligationSeed[] = RETENTION_FLOOR_OBLIGATIONS,
): { attached: FloorAttachment[]; unattached: RetentionFloorObligationSeed[] } {
  const attached: FloorAttachment[] = [];
  const unattached: RetentionFloorObligationSeed[] = [];
  for (const floor of floors) {
    const candidates = regulations.filter((r) =>
      regulationCoversArchetypes(r.applicability, floor.archetypes),
    );

    // The regulation the floor is actually about, if this install seeds it.
    let match: RegulationRow | undefined;
    let basis: FloorAttachmentBasis = "preferred";
    for (const preferred of floor.preferredRegulationIds) {
      const hit = candidates.find((r) => r.regulationId === preferred);
      if (hit) {
        match = hit;
        break;
      }
    }

    // Fallback: the lowest regulationId among the matches, so an install that
    // seeds none of the named regulations still gets its floor rather than
    // silently losing it. Deterministic, but not a considered citation.
    if (!match) {
      match = [...candidates].sort((a, b) => a.regulationId.localeCompare(b.regulationId))[0];
      basis = "fallback";
    }

    if (match) attached.push({ floor, regulation: match, basis });
    else unattached.push(floor);
  }
  return { attached, unattached };
}

export async function seedRetentionFloorObligations(prisma: PrismaClient): Promise<void> {
  const regulations = (await prisma.regulation.findMany({
    where: { status: "active" },
    select: { id: true, regulationId: true, applicability: true },
  })) as RegulationRow[];

  const { attached, unattached } = planRetentionFloorObligations(regulations);

  let created = 0;
  let updated = 0;
  const fallbacks: string[] = [];
  const recited: string[] = [];
  for (const { floor, regulation, basis } of attached) {
    // A fallback attachment cites a regulation that merely covers the archetype,
    // not one the floor names. Say so: it is a weaker claim, and it is how an
    // operator finds out this install lacks the regulation the floor is about.
    if (basis === "fallback") fallbacks.push(`${floor.reference} -> ${regulation.regulationId}`);
    // Find by REFERENCE ALONE, not (regulationId, reference).
    //
    // MOVE, DO NOT DELETE AND RECREATE (BI-0C723E18). A floor's reference
    // identifies ONE rule, so it lives on exactly one regulation, and this fix
    // changes which one. Keying the lookup on (regulationId, reference) would
    // find nothing at the new regulation, create a second row, and leave the
    // old one standing: a duplicate floor still citing the wrong regulator on
    // that regulation's page. The retention window would be unaffected, since
    // both rows state the same duration and the fold takes the longest per
    // bucket — but the wrong citation IS the defect, so leaving it fixes
    // nothing.
    //
    // Deleting the stale row and creating a fresh one would also work, and is
    // worse: an Obligation carries linked controls and collected evidence, and
    // a recreate orphans both. Re-pointing regulationId moves the row intact
    // and destroys nothing, which is why this path is not a destructive one.
    //
    // Only one row per reference can exist, because before this change a floor
    // could attach to just one regulation (the alphabetical pick).
    const existing = await prisma.obligation.findFirst({
      where: { reference: floor.reference },
      select: { id: true, regulationId: true },
    });
    const data = {
      title: floor.title,
      description: floor.description,
      reference: floor.reference,
      category: "records",
      frequency: "continuous",
      applicability: `Applies while the install operates as: ${floor.archetypes.join(", ")}`,
      retentionMinimumDays: floor.retentionMinimumDays,
      retentionFloorBuckets: [...floor.retentionFloorBuckets],
    };
    if (existing) {
      // Re-seed keeps the stated minimum current without minting a duplicate,
      // and re-points the citation when the floor now names a different
      // regulation.
      const moved = existing.regulationId !== regulation.id;
      await prisma.obligation.update({
        where: { id: existing.id },
        data: moved ? { ...data, regulationId: regulation.id } : data,
      });
      updated += 1;
      if (moved) recited.push(`${floor.reference} -> ${regulation.regulationId}`);
    } else {
      await prisma.obligation.create({
        data: { ...data, obligationId: makeId("OBL"), regulationId: regulation.id },
      });
      created += 1;
    }
  }

  console.log(
    `[seed] retention floor obligations: ${created} created, ${updated} refreshed, ` +
      `${unattached.length} unattached (no seeded regulation names their archetype: ` +
      `${unattached.map((f) => f.reference).join(", ") || "none"})`,
  );
  if (recited.length > 0) {
    console.log(
      `[seed] retention floor obligations: re-pointed ${recited.length} floor(s) onto the regulation ` +
        `they name (the row moved intact; its controls and evidence are preserved): ${recited.join(", ")}`,
    );
  }
  if (fallbacks.length > 0) {
    console.warn(
      `[seed] retention floor obligations: ${fallbacks.length} attached by FALLBACK — this ` +
        `install seeds none of the regulations the floor names, so the citation only covers ` +
        `the archetype: ${fallbacks.join(", ")}`,
    );
  }
}
