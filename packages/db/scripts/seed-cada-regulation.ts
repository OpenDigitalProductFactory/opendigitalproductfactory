/**
 * EP-ESTATE-SOVEREIGNTY: CADA Regulation Onboarding Seed Script
 *
 * Seeds the EU Cloud and AI Development Act (CADA, Commission proposal of
 * 3 June 2026) into the governance domain: obligations across the four Union
 * assurance levels plus procurement and capacity, suggested controls mapped to
 * DPF's shipped sovereignty capabilities, control-obligation links, a Cloud & AI
 * Sovereignty Policy, and policy requirements.
 *
 * CADA is a PROPOSAL, not yet binding law (Parliament/Council/trilogue ahead;
 * realistic application 2027-2028). Article numbers are not final — obligation
 * `reference` strings are stable assurance-level keys, not citations.
 *
 * Mirrors the DORA seed (seed-dora-regulation.ts), reusing the existing
 * Regulation/Obligation/Control/Policy models — no schema change.
 *
 * Run: cd packages/db && npx tsx scripts/seed-cada-regulation.ts
 */
import { PrismaClient, type Prisma } from "../generated/client/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { CADA_APPLICABILITY } from "../src/regulation-applicability";
import * as crypto from "crypto";
import { loadDbEnv } from "../src/load-env";

loadDbEnv();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function makeId(prefix: string): string {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${hex}`;
}

// ─── Data ──────────────────────────────────────────────────────────────────────

const CADA_REG = {
  regulationId: "REG-CADA-2026",
  name: "Cloud and AI Development Act",
  shortName: "CADA",
  jurisdiction: "EU",
  industry: null as string | null, // cross-sector: public bodies + critical-sector entities
  sourceType: "external" as const,
  effectiveDate: null as Date | null, // proposal — not yet in force
  reviewDate: null as Date | null,
  sourceUrl: "https://digital-strategy.ec.europa.eu/en/policies/cloud-and-ai-development-act",
  notes:
    "EU Cloud and AI Development Act — European Commission proposal published 3 June 2026. " +
    "PROPOSAL, not yet binding (Parliament/Council/trilogue ahead; realistic application 2027-2028). " +
    "Defines four 'Union assurance levels' for public-sector cloud/AI procurement, gating the top tiers " +
    "on EU ownership and the absence of third-country interference, not on data location. " +
    "Mandatory for EU public bodies; cascades to NIS2 essential entities and their suppliers. " +
    "Countries affected: 27 EU member states (Level 1 residency holds across the EEA, +Iceland/Liechtenstein/Norway); " +
    "any operator controlled from outside the EEA is a 'third country' for Level 3/4. " +
    "Interlocks with DORA, NIS2, the EU AI Act, GDPR adequacy, and the EUCS/CSF-SEAL rubric. Penalties TBD in trilogue.",
};

// Obligations organised by assurance level / pillar. `reference` is the stable upsert key.
const OBLIGATIONS: Array<{
  title: string;
  reference: string;
  description: string;
  category: string;
  frequency: string;
  applicability: string;
  penaltySummary: string | null;
}> = [
  // ── Level 1 — residency ──────────────────────────────────────────────────
  {
    title: "Level 1 — EU data residency",
    reference: "Assurance Level 1 — residency",
    description:
      "Infrastructure, assets, and customer data are established and maintained in the EU. " +
      "The baseline for any cloud/AI service procured by an EU public body.",
    category: "data-protection",
    frequency: "continuous",
    applicability: "Cloud/AI services used by EU public bodies; baseline tier",
    penaltySummary: null,
  },
  {
    title: "Level 1 — vulnerability non-disclosure to third countries",
    reference: "Assurance Level 1 — vulnerability non-disclosure",
    description:
      "A third-country-controlled provider must guarantee non-disclosure of unexploited " +
      "vulnerabilities to third-country authorities.",
    category: "cybersecurity",
    frequency: "continuous",
    applicability: "Third-country-controlled providers at Level 1+",
    penaltySummary: null,
  },
  // ── Level 2 — independence + supply-chain transparency ───────────────────
  {
    title: "Level 2 — EU personnel, infrastructure and assets",
    reference: "Assurance Level 2 — EU operations",
    description:
      "All personnel, infrastructure, and assets involved in operating the service are located in the EU. " +
      "Required for critical-sector workloads.",
    category: "operational",
    frequency: "continuous",
    applicability: "Critical-sector / NIS2 essential-entity workloads",
    penaltySummary: null,
  },
  {
    title: "Level 2 — EU cloud certification",
    reference: "Assurance Level 2 — certification",
    description:
      "Compliance with the EU cloud certification scheme (EUCS, when finalised), plus measures preventing " +
      "third-country data access and sanctions/trade-control exposure.",
    category: "cybersecurity",
    frequency: "annual",
    applicability: "Level 2+ providers",
    penaltySummary: null,
  },
  {
    title: "Level 2 — software bill of materials (SBOM)",
    reference: "Assurance Level 2 — SBOM",
    description:
      "Maintain a complete software bill of materials providing transparency over the software supply chain.",
    category: "cybersecurity",
    frequency: "continuous",
    applicability: "Level 2+ providers",
    penaltySummary: null,
  },
  {
    title: "Level 2 — source-code audit of third-country components",
    reference: "Assurance Level 2 — source-code audit",
    description:
      "Source-code audits for third-country software components, and effective legal/technical/organisational " +
      "separation from non-EU subsidiaries.",
    category: "cybersecurity",
    frequency: "annual",
    applicability: "Level 2+ providers with third-country components",
    penaltySummary: null,
  },
  // ── Level 3 — EU ownership and control ───────────────────────────────────
  {
    title: "Level 3 — EU ownership and control",
    reference: "Assurance Level 3 — EU ownership",
    description:
      "The provider must be owned and controlled in the EU. Derogation only where the Commission recognises " +
      "a third country meets conditions: GDPR adequacy, no compelled service degradation, open market access.",
    category: "operational",
    frequency: "continuous",
    applicability: "High-sensitivity public-sector workloads",
    penaltySummary: null,
  },
  // ── Level 4 — no third-country interference ──────────────────────────────
  {
    title: "Level 4 — no third-country interference",
    reference: "Assurance Level 4 — no interference",
    description:
      "No derogations: the provider cannot be controlled by a third country, and no third-country entity holds " +
      "effective control over software design, development, maintenance, or evolution.",
    category: "operational",
    frequency: "continuous",
    applicability: "Defence / national-security workloads (~1% of public services)",
    penaltySummary: null,
  },
  {
    title: "Level 4 — high cybersecurity certification & software control",
    reference: "Assurance Level 4 — high certification",
    description:
      "European cybersecurity certificate at the 'high' assurance level, and demonstrated effective control over " +
      "all software components (including no silent third-country update path).",
    category: "cybersecurity",
    frequency: "annual",
    applicability: "Level 4 providers",
    penaltySummary: null,
  },
  // ── Procurement & capacity pillars ───────────────────────────────────────
  {
    title: "Procurement — Union added-value criteria",
    reference: "Procurement — Union added-value",
    description:
      "Public authorities consider Union added-value criteria (EU-developed technology, EU innovation/manufacturing) " +
      "in cloud/AI procurement. Ancillary weighting (max 15 of 120 points).",
    category: "operational",
    frequency: "event-driven",
    applicability: "EU public-body procurement",
    penaltySummary: null,
  },
  {
    title: "Capacity — data-centre acceleration zones",
    reference: "Capacity — acceleration zones",
    description:
      "Member states designate acceleration zones with streamlined permitting (max 12-month timeline) to triple " +
      "EU data-centre capacity within 5-7 years. Member-state obligation; context for capacity planning.",
    category: "operational",
    frequency: "event-driven",
    applicability: "EU member states (capacity pillar)",
    penaltySummary: null,
  },
];

// Suggested controls mapped to DPF's shipped (and planned) sovereignty capabilities.
const CONTROLS: Array<{
  title: string;
  description: string;
  controlType: string;
  implementationStatus: string;
  obligationRefs: string[];
}> = [
  {
    title: "Self-hosted, single-tenant deployment on EU infrastructure",
    description:
      "Run the platform on customer-controlled or EU-owned infrastructure (Postgres/Neo4j/Qdrant on the customer's " +
      "Docker host or EU cloud account). Keeps data in the EU by construction.",
    controlType: "preventive",
    implementationStatus: "implemented",
    obligationRefs: ["Assurance Level 1 — residency", "Assurance Level 2 — EU operations"],
  },
  {
    title: "Local-only AI inference with no silent cloud fallback",
    description:
      "residencyPolicy='local_only' hard-filters routing to local providers and fails loudly rather than reaching a " +
      "foreign cloud. Implements the Level 4 'no AI-inference-data egress' test.",
    controlType: "preventive",
    implementationStatus: "implemented",
    obligationRefs: ["Assurance Level 4 — no interference", "Assurance Level 2 — certification"],
  },
  {
    title: "Open-source codebase with audit and fork rights",
    description:
      "Public, open-source codebase the customer can run, audit, and fork — answering the Level 2 supply-chain " +
      "transparency requirement and the Level 3/4 vendor-control objection.",
    controlType: "preventive",
    implementationStatus: "implemented",
    obligationRefs: [
      "Assurance Level 2 — source-code audit",
      "Assurance Level 3 — EU ownership",
      "Assurance Level 4 — no interference",
    ],
  },
  {
    title: "Signed software bill of materials (SBOM)",
    description:
      "Generate and sign an SBOM for each release, providing machine-readable supply-chain transparency. Build-out " +
      "tracked in EP-ASSURANCE-LEDGER.",
    controlType: "preventive",
    implementationStatus: "planned",
    obligationRefs: ["Assurance Level 2 — SBOM"],
  },
  {
    title: "Route-decision and tool-execution audit log",
    description:
      "RouteDecisionLog records which model/provider served each request (proving local-only routing held); " +
      "ToolExecution and the ITIL ChangeRequest register provide the assurance-evidence trail.",
    controlType: "detective",
    implementationStatus: "implemented",
    obligationRefs: [
      "Assurance Level 1 — vulnerability non-disclosure",
      "Assurance Level 4 — high certification",
    ],
  },
  {
    title: "EU-held encryption keys (hold-your-own-key)",
    description:
      "Encryption keys held in an EU-controlled HSM external to any foreign operator, so a third-country order " +
      "returns only ciphertext. Partner integration (e.g. Thales/Cosmian).",
    controlType: "preventive",
    implementationStatus: "planned",
    obligationRefs: ["Assurance Level 2 — certification"],
  },
  {
    title: "EU steward / support entity and reproducible builds",
    description:
      "Governance posture closing the strictest Level 4 test for a foreign-domiciled maintainer: EU support/steward " +
      "entity, reproducible builds, and signed artifacts.",
    controlType: "preventive",
    implementationStatus: "planned",
    obligationRefs: ["Assurance Level 4 — no interference"],
  },
  {
    title: "Jurisdiction and target-assurance-level capture at setup",
    description:
      "Capture operatesIn/sellsTo/employsIn/dataResidency (and, forward, a target assurance level) on BusinessContext " +
      "so the right obligations apply and procurement claims are scoped.",
    controlType: "preventive",
    implementationStatus: "in-progress",
    obligationRefs: ["Assurance Level 3 — EU ownership", "Procurement — Union added-value"],
  },
];

const POLICY = {
  title: "Cloud & AI Sovereignty Policy",
  description:
    "Governs how the organisation selects, deploys, and assesses cloud and AI services against CADA's four " +
    "assurance levels: ownership/control is the gate, data location is the baseline. Applies to the platform " +
    "itself and to estate elements (discovered infrastructure, edge nodes, external digital products).",
  category: "cybersecurity",
};

const POLICY_REQUIREMENTS: Array<{
  title: string;
  requirementType: string;
  description: string;
  frequency: string | null;
  applicability: string;
}> = [
  {
    title: "Annual cloud & AI sovereignty posture review",
    requirementType: "attestation",
    description:
      "Review the install's sovereignty posture against its target assurance level and the seeded CADA obligations.",
    frequency: "annual",
    applicability: "all-employees",
  },
  {
    title: "Sovereignty assessment before adopting an external cloud/AI service",
    requirementType: "action",
    description:
      "Before adopting a new external cloud/AI service, assess the operator's ownership jurisdiction and the " +
      "achievable assurance level; record the finding.",
    frequency: "event-driven",
    applicability: "role:IT-security-compliance",
  },
];

// ─── Seed ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("EP-ESTATE-SOVEREIGNTY: Seeding CADA regulation data...\n");

  // 1. Create Regulation
  const existingReg = await prisma.regulation.findUnique({
    where: { regulationId: CADA_REG.regulationId },
  });

  // Data-driven applicability: CADA gates on an EU operating/selling nexus.
  const applicability = CADA_APPLICABILITY as unknown as Prisma.InputJsonValue;
  let regulation: { id: string; regulationId: string };
  if (existingReg) {
    console.log(`Regulation ${CADA_REG.regulationId} already exists — updating.`);
    regulation = await prisma.regulation.update({
      where: { regulationId: CADA_REG.regulationId },
      data: {
        name: CADA_REG.name,
        shortName: CADA_REG.shortName,
        jurisdiction: CADA_REG.jurisdiction,
        industry: CADA_REG.industry,
        sourceType: CADA_REG.sourceType,
        effectiveDate: CADA_REG.effectiveDate,
        reviewDate: CADA_REG.reviewDate,
        sourceUrl: CADA_REG.sourceUrl,
        notes: CADA_REG.notes,
        applicability,
      },
    });
  } else {
    regulation = await prisma.regulation.create({
      data: {
        regulationId: CADA_REG.regulationId,
        ...CADA_REG,
        applicability,
      },
    });
    console.log(`Created regulation: ${CADA_REG.shortName} (${regulation.id})`);
  }

  // Log to ComplianceAuditLog
  await prisma.complianceAuditLog.create({
    data: {
      entityType: "regulation",
      entityId: regulation.id,
      action: "created",
      notes: "CADA regulation onboarded via seed script (EP-ESTATE-SOVEREIGNTY)",
    },
  });

  // 2. Create Obligations
  console.log(`\nCreating ${OBLIGATIONS.length} CADA obligations...`);
  const oblMap = new Map<string, string>(); // reference → id
  let oblCreated = 0;
  let oblSkipped = 0;

  for (const obl of OBLIGATIONS) {
    const existing = await prisma.obligation.findFirst({
      where: {
        regulationId: regulation.id,
        reference: obl.reference,
        status: "active",
      },
    });

    if (existing) {
      oblMap.set(obl.reference, existing.id);
      oblSkipped++;
      continue;
    }

    const created = await prisma.obligation.create({
      data: {
        obligationId: makeId("OBL"),
        regulationId: regulation.id,
        title: obl.title,
        description: obl.description,
        reference: obl.reference,
        category: obl.category,
        frequency: obl.frequency,
        applicability: obl.applicability,
        penaltySummary: obl.penaltySummary,
      },
    });
    oblMap.set(obl.reference, created.id);
    oblCreated++;

    await prisma.complianceAuditLog.create({
      data: {
        entityType: "obligation",
        entityId: created.id,
        action: "created",
        notes: `CADA ${obl.reference}: ${obl.title}`,
      },
    });
  }
  console.log(`  Created: ${oblCreated}, Skipped (existing): ${oblSkipped}`);

  // 3. Create Controls and link to obligations
  console.log(`\nCreating ${CONTROLS.length} controls and linking to obligations...`);
  let ctlCreated = 0;
  let ctlSkipped = 0;
  let linksCreated = 0;

  for (const ctl of CONTROLS) {
    const existing = await prisma.control.findFirst({
      where: { title: ctl.title, status: "active" },
    });

    let controlId: string;
    if (existing) {
      controlId = existing.id;
      ctlSkipped++;
    } else {
      const created = await prisma.control.create({
        data: {
          controlId: makeId("CTL"),
          title: ctl.title,
          description: ctl.description,
          controlType: ctl.controlType,
          implementationStatus: ctl.implementationStatus,
        },
      });
      controlId = created.id;
      ctlCreated++;

      await prisma.complianceAuditLog.create({
        data: {
          entityType: "control",
          entityId: controlId,
          action: "created",
          notes: `CADA control: ${ctl.title}`,
        },
      });
    }

    // Link control to obligations
    for (const ref of ctl.obligationRefs) {
      const oblId = oblMap.get(ref);
      if (!oblId) {
        console.warn(`  WARNING: No obligation found for reference ${ref}`);
        continue;
      }

      const existingLink = await prisma.controlObligationLink.findUnique({
        where: {
          controlId_obligationId: { controlId, obligationId: oblId },
        },
      });

      if (!existingLink) {
        await prisma.controlObligationLink.create({
          data: { controlId, obligationId: oblId },
        });
        linksCreated++;

        await prisma.complianceAuditLog.create({
          data: {
            entityType: "control",
            entityId: controlId,
            action: "linked",
            notes: `Linked to obligation ${ref}`,
          },
        });
      }
    }
  }
  console.log(`  Controls created: ${ctlCreated}, Skipped: ${ctlSkipped}`);
  console.log(`  Control-obligation links created: ${linksCreated}`);

  // 4. Create Policy linked to the Level 1 obligation
  console.log(`\nCreating Cloud & AI Sovereignty Policy...`);
  const existingPolicy = await prisma.policy.findFirst({
    where: { title: POLICY.title, status: "active" },
  });

  let policyId: string;
  if (existingPolicy) {
    console.log(`  Policy "${POLICY.title}" already exists — skipping.`);
    policyId = existingPolicy.id;
  } else {
    const govOblId = oblMap.get("Assurance Level 1 — residency");

    const created = await prisma.policy.create({
      data: {
        policyId: makeId("POL"),
        title: POLICY.title,
        description: POLICY.description,
        category: POLICY.category,
        lifecycleStatus: "draft",
        obligationId: govOblId ?? null,
      },
    });
    policyId = created.id;
    console.log(`  Created policy: ${POLICY.title} (${policyId})`);

    await prisma.complianceAuditLog.create({
      data: {
        entityType: "policy",
        entityId: policyId,
        action: "created",
        notes: `CADA Cloud & AI Sovereignty Policy created via seed script`,
      },
    });
  }

  // 5. Create Policy Requirements
  console.log(`\nCreating ${POLICY_REQUIREMENTS.length} policy requirements...`);
  let reqCreated = 0;
  let reqSkipped = 0;

  for (const req of POLICY_REQUIREMENTS) {
    const existing = await prisma.policyRequirement.findFirst({
      where: { policyId, title: req.title, status: "active" },
    });

    if (existing) {
      reqSkipped++;
      continue;
    }

    const created = await prisma.policyRequirement.create({
      data: {
        requirementId: makeId("PREQ"),
        policyId,
        title: req.title,
        requirementType: req.requirementType,
        description: req.description,
        frequency: req.frequency,
        applicability: req.applicability,
      },
    });
    reqCreated++;

    if (req.requirementType === "training") {
      await prisma.trainingRequirement.create({
        data: {
          requirementId: created.id,
          trainingTitle: req.title,
          provider: "internal",
          deliveryMethod: "online",
          durationMinutes: 60,
        },
      });
    }

    await prisma.complianceAuditLog.create({
      data: {
        entityType: "requirement",
        entityId: created.id,
        action: "created",
        notes: `Policy requirement: ${req.title}`,
      },
    });
  }
  console.log(`  Created: ${reqCreated}, Skipped: ${reqSkipped}`);

  // 6. Summary
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("EP-ESTATE-SOVEREIGNTY: CADA Onboarding Complete");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Regulation:        ${CADA_REG.shortName} (${CADA_REG.regulationId})`);
  console.log(`Obligations:       ${oblCreated} created, ${oblSkipped} existing`);
  console.log(`Controls:          ${ctlCreated} created, ${ctlSkipped} existing`);
  console.log(`Control-Obl Links: ${linksCreated} created`);
  console.log(`Policy:            ${POLICY.title}`);
  console.log(`Requirements:      ${reqCreated} created, ${reqSkipped} existing`);
  console.log("═══════════════════════════════════════════════════════════\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
