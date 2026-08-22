import type { PrismaClient } from "../generated/client/client";
import * as crypto from "crypto";
import { type RegulationApplicability, type RegulationDomain } from "./regulation-applicability";

// COMMON recurring business-operations pack.
//
// The gap this fills, measured: of the obligations that reach an install
// regardless of what it does, only 11 RECUR. Everything else is a standing duty
// or an event-driven one — correctly dateless, and therefore invisible to the
// deadline-horizon watch. So a business could run the watch and see an empty
// calendar while its annual filing, its tax return, and its insurance renewal
// all came and went. Those are the obligations every business has, and they are
// exactly the ones nothing was shipping.
//
// AUTHORITY AND ITS LIMITS — read before adding a row.
//
// Every obligation here is deliberately chosen to be STRUCTURALLY stable: the
// duty exists for essentially every US business entity and its recurrence is a
// property of the duty, not of a threshold or a rate that moves. Amounts,
// thresholds, forms, and exact due dates are NOT stated, because those move and
// a wrong one printed next to a due date reads as authoritative.
//
// Where a cadence genuinely varies by state (periodic reports are annual in most
// states and biennial in some), the row declares the SHORTER period. A reminder
// that arrives early is safe; one that arrives late is not, and the applicability
// text says plainly that the operator must confirm their own state's cycle.
//
// What is deliberately NOT here: anything whose applicability turns on a
// headcount, revenue, or entity-type threshold; anything in active regulatory
// flux; and any industry duty — those belong in an archetype pack, gated to the
// archetype, not shipped to every install.

function makeId(prefix: string): string {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${hex}`;
}

type ObligationSeed = {
  title: string;
  reference: string;
  description: string;
  category: string;
  frequency: string;
  applicability: string;
  penaltySummary: string | null;
};

type RegulationSeed = {
  regulationId: string;
  name: string;
  shortName: string;
  jurisdiction: string;
  industry: string | null;
  sourceType: "external";
  sourceUrl: string | null;
  applicability: RegulationApplicability;
  domain: RegulationDomain;
  notes: string;
  obligations: ObligationSeed[];
};

/** Binds on operating a registered entity in the US, whatever the entity does. */
const US_OPERATING: RegulationApplicability = {
  basis: ["operating"],
  jurisdictions: ["us"],
};

/** Binds on employing people in the US, whatever the employer does. */
const US_EMPLOYING: RegulationApplicability = {
  basis: ["employing"],
  jurisdictions: ["us"],
};

export const BUSINESS_OPERATIONS_REGULATIONS: RegulationSeed[] = [
  {
    regulationId: "REG-US-ENTITY-STANDING",
    domain: "corporate-governance",
    name: "State entity good standing and periodic reporting",
    shortName: "Entity Standing",
    jurisdiction: "US-state",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.sba.gov/business-guide/manage-your-business/stay-legally-compliant",
    applicability: US_OPERATING,
    notes:
      "Every US registered entity must stay in good standing with its state of formation and with "
      + "any state it is foreign-qualified in. The duties below exist in essentially every state; "
      + "the FILING NAME, the FEE, and the exact DUE DATE differ by state and are deliberately not "
      + "stated here. Losing good standing can void the liability shield and block financing, so "
      + "these are high-consequence and low-visibility — the combination the watch exists for.",
    obligations: [
      {
        title: "File the state periodic (annual) report",
        reference: "entity/periodic-report",
        description:
          "File the periodic report — variously called an annual report, statement of information, "
          + "or annual registration — with the Secretary of State (or equivalent) in the state of "
          + "formation and in every state the entity is foreign-qualified in. Confirm the registered "
          + "office, principal address, and officers/managers on record are still correct.",
        category: "governance",
        // Annual in most states, biennial in some. The shorter period is
        // declared deliberately: an early reminder is safe, a late one is not.
        frequency: "annual",
        applicability:
          "All US registered entities. Cadence is annual in most states and biennial in some "
          + "(and a handful tie the due date to the formation anniversary rather than a fixed "
          + "date) — confirm your own state's cycle and set the review date to match.",
        penaltySummary:
          "Late fees, administrative dissolution or revocation of authority to transact, and loss "
          + "of good standing — which can void the liability shield and block financing or sale.",
      },
      {
        title: "Maintain a registered agent and registered office",
        reference: "entity/registered-agent",
        description:
          "Keep a registered agent with a physical address in each state of registration, able to "
          + "receive service of process during business hours, and keep that record current.",
        category: "governance",
        // A standing duty, not a schedule. Correctly dateless.
        frequency: "continuous",
        applicability: "All US registered entities, in every state of registration.",
        penaltySummary:
          "Administrative dissolution, and default judgments entered because service of process "
          + "was never actually received.",
      },
      {
        title: "Update the state record after a change of address, officers, or agent",
        reference: "entity/record-change",
        description:
          "File the state's change notice when the registered agent, registered office, principal "
          + "address, or the officers/managers on record change.",
        category: "governance",
        frequency: "event-driven",
        applicability: "All US registered entities. Filing deadlines after a change vary by state.",
        penaltySummary: "Loss of good standing and missed legal notices.",
      },
    ],
  },
  {
    regulationId: "REG-US-BUSINESS-TAX-CYCLE",
    domain: "finance",
    name: "Federal business tax filing cycle",
    shortName: "Federal Tax Cycle",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.irs.gov/businesses/small-businesses-self-employed/business-taxes",
    applicability: US_OPERATING,
    notes:
      "The recurring federal filing spine every US business entity sits on. WHICH return and WHICH "
      + "form depend on entity classification, and the due dates depend on the fiscal year end, so "
      + "neither is asserted here — only that the duty recurs and needs a date on the calendar. "
      + "State and local tax cycles are separate and are not covered by this pack.",
    obligations: [
      {
        title: "File the annual federal income tax return",
        reference: "tax/annual-return",
        description:
          "File the entity's federal income tax return for the tax year, or file a timely extension. "
          + "The return and its due date depend on the entity's classification and fiscal year end.",
        category: "financial",
        frequency: "annual",
        applicability:
          "All US business entities. Form and due date depend on entity classification "
          + "(corporation, S corporation, partnership, or disregarded entity) and on the fiscal "
          + "year end — confirm both with your accountant and set the review date accordingly.",
        penaltySummary: "Failure-to-file and failure-to-pay penalties, plus interest that accrues until paid.",
      },
      {
        title: "Pay quarterly estimated tax",
        reference: "tax/estimated-quarterly",
        description:
          "Pay estimated tax for the current year in instalments where the entity or its owners "
          + "expect to owe tax not covered by withholding.",
        category: "financial",
        frequency: "quarterly",
        applicability:
          "US entities and owners expecting to owe tax beyond withholding. Whether instalments are "
          + "required, and how much, depends on the prior and current year position.",
        penaltySummary: "Underpayment penalties charged per instalment period, even if the annual return is paid in full.",
      },
    ],
  },
  {
    regulationId: "REG-US-EMPLOYER-CYCLE",
    domain: "hr-employment",
    name: "Employer recurring filing and coverage cycle",
    shortName: "Employer Cycle",
    jurisdiction: "US-federal",
    industry: null,
    sourceType: "external",
    sourceUrl: "https://www.irs.gov/businesses/small-businesses-self-employed/employment-taxes",
    applicability: US_EMPLOYING,
    notes:
      "Recurring duties that begin the moment a business has its first employee, and that are "
      + "commonly missed by a business whose first hire was recent. Deposit SCHEDULE (monthly vs "
      + "semi-weekly) is assigned by the IRS from a lookback period and is not asserted here.",
    obligations: [
      {
        title: "File the quarterly federal employment tax return",
        reference: "employment/quarterly-return",
        description:
          "Report wages paid, and income tax and FICA withheld and owed, for the quarter. Some very "
          + "small employers file annually instead of quarterly, on IRS notification.",
        category: "financial",
        frequency: "quarterly",
        applicability:
          "US employers. A small number of employers are notified by the IRS to file annually "
          + "rather than quarterly — if that is you, change this obligation's frequency.",
        penaltySummary: "Failure-to-file and failure-to-deposit penalties, escalating with lateness.",
      },
      {
        title: "Issue annual wage and contractor statements",
        reference: "employment/annual-statements",
        description:
          "Furnish wage statements to employees and information returns to qualifying contractors "
          + "for the prior calendar year, and file the corresponding copies with the authorities.",
        category: "reporting",
        frequency: "annual",
        applicability:
          "US employers, and any business that paid qualifying non-employee compensation. Due "
          + "early in the calendar year — confirm the current year's date.",
        penaltySummary: "Per-statement penalties for late, incorrect, or unfurnished statements, scaling with delay.",
      },
      {
        title: "Maintain workers' compensation coverage",
        reference: "employment/workers-comp",
        description:
          "Hold workers' compensation cover meeting the requirements of every state the business "
          + "has employees in, and keep the policy in force without lapse.",
        category: "operational",
        frequency: "continuous",
        applicability:
          "US employers. Whether cover is mandatory, and from which employee, is set by each state "
          + "— a handful exempt very small employers.",
        penaltySummary:
          "Stop-work orders, per-day fines, and direct personal liability for an injured worker's "
          + "costs where cover had lapsed.",
      },
      {
        title: "Renew business insurance cover",
        reference: "operations/insurance-renewal",
        description:
          "Review and renew the entity's business insurance before expiry — typically general "
          + "liability, plus any cover a lease, lender, client contract, or licence requires. "
          + "Confirm the sums insured still match the size of the business.",
        category: "operational",
        frequency: "annual",
        applicability:
          "All operating businesses. The cover REQUIRED depends on the trade, the premises, and "
          + "contractual commitments; the renewal cycle is typically annual.",
        penaltySummary:
          "Uninsured loss, breach of a lease or client contract, and licence conditions failing "
          + "where proof of cover is a condition of holding the licence.",
      },
    ],
  },
];

export async function seedBusinessOperationsCompliance(prisma: PrismaClient): Promise<void> {
  let regUpserts = 0;
  let oblCreated = 0;

  for (const { obligations, applicability, ...regData } of BUSINESS_OPERATIONS_REGULATIONS) {
    const regulation = await prisma.regulation.upsert({
      where: { regulationId: regData.regulationId },
      update: {
        name: regData.name,
        shortName: regData.shortName,
        jurisdiction: regData.jurisdiction,
        sourceUrl: regData.sourceUrl,
        notes: regData.notes,
        applicability: applicability as never,
        domain: regData.domain,
      },
      create: { ...regData, applicability: applicability as never },
    });
    regUpserts++;

    for (const obl of obligations) {
      const existing = await prisma.obligation.findFirst({
        where: { regulationId: regulation.id, reference: obl.reference, status: "active" },
        select: { id: true },
      });
      if (existing) continue;
      await prisma.obligation.create({
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
      oblCreated++;
    }
  }

  const expected = BUSINESS_OPERATIONS_REGULATIONS.reduce((n, r) => n + r.obligations.length, 0);
  console.log(
    `[seed] Business operations compliance pack: ${regUpserts}/${BUSINESS_OPERATIONS_REGULATIONS.length} regulations upserted, `
      + `${oblCreated} obligations created (${expected} expected total)`,
  );
}
