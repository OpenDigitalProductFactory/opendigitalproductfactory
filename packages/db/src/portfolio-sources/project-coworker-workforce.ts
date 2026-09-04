// AI coworker → Workforce DigitalProduct projector (BI-8F9EDD6C, EP-BOM-WIRING).
//
// The founder invariant DOC-7693D528 is that AI coworkers are role-shaped
// non-human workforce peers, NOT detached automation services. The portfolio
// model already links CoworkerService/CoworkerOffer to DigitalProduct, but the
// product association is not yet load-bearing. This projector makes it so:
//
//   1. Project each active AI coworker (Agent) as a DigitalProduct under
//      `for_employees` (Workforce), carrying its human-role parity anchor and
//      approval/interface owner in observationConfig (reusing the shared,
//      idempotent, non-destructive projectPortfolioEntries writer).
//   2. Back-link the coworker's substrate to that product WITHOUT churn:
//        - set Agent.portfolioId → for_employees (only when unset), and
//        - set CoworkerService.digitalProductId → the coworker product
//          (only for services with no product yet).
//
// This does NOT introduce a parallel coworker-product registry — it reuses
// Portfolio, DigitalProduct, Agent, and CoworkerService. Backlog and capability
// needs resolve their portfolio through DigitalProduct.portfolioId once linked
// (the DOC-1996319D "DigitalProduct first" reassociation rule).

import { prisma } from "../client";
import { COWORKER_SLUG_TO_CANONICAL_AGENT_ID } from "../agent-identity";
import {
  projectPortfolioEntries,
  type ProjectPortfolioClient,
  type ProjectPortfolioResult,
} from "./project-portfolio-source";
import type { ProjectedPortfolioEntry } from "./types";

const FOR_EMPLOYEES_SLUG = "for_employees" as const;

/** Structural client — the writer client plus the coworker back-link surface. */
export type ProjectCoworkerWorkforceClient = ProjectPortfolioClient & {
  agent: {
    findMany: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
  coworkerService: {
    updateMany: (args: unknown) => Promise<unknown>;
  };
};

export type ProjectCoworkerWorkforceResult = ProjectPortfolioResult & {
  /** AI coworkers projected as Workforce products. */
  coworkers: number;
  /** Agents whose portfolioId was set to for_employees (were previously unset). */
  agentsPortfolioLinked: number;
  /** CoworkerService rows linked to their coworker DigitalProduct. */
  servicesLinked: number;
};

type CoworkerAgentRow = {
  agentId: string;
  displayName: string;
  name: string;
  kind: string;
  status: string;
  valueStream: string | null;
  humanSupervisorId: string | null;
  portfolioId: string | null;
};

/** Stable, deterministic product id per coworker so re-projection is idempotent. */
export function coworkerProductId(agentId: string): string {
  return `coworker-${agentId}`;
}

function buildEntry(agent: CoworkerAgentRow): ProjectedPortfolioEntry {
  const label = agent.displayName || agent.name || agent.agentId;
  const roleShape = [agent.kind, agent.valueStream].filter(Boolean).join(" · ") || "coworker";
  const parity = agent.humanSupervisorId ?? "unassigned";
  return {
    productId: coworkerProductId(agent.agentId),
    name: label,
    description:
      `AI coworker (${roleShape}) as a Workforce product. Role-shaped non-human peer ` +
      `(DOC-7693D528); human-role parity / approval-interface owner: ${parity}.`,
    portfolioSlug: FOR_EMPLOYEES_SLUG,
    taxonomyNodeId: null,
    // An active coworker is workforce the org is actively using; others are available.
    coverageStatus: agent.status === "active" ? "used" : "available",
    sourceKind: "coworker_service",
    observationExtras: {
      agentId: agent.agentId,
      coworkerKind: agent.kind,
      valueStream: agent.valueStream ?? "",
      humanRoleParity: agent.humanSupervisorId ?? "",
      approvalInterfaceOwnerRole: agent.humanSupervisorId ?? "",
    },
  };
}

const EMPTY: ProjectCoworkerWorkforceResult = {
  total: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  coworkers: 0,
  agentsPortfolioLinked: 0,
  servicesLinked: 0,
};

/**
 * Project active AI coworkers as Workforce DigitalProducts and back-link their
 * Agent.portfolioId and CoworkerService.digitalProductId. Idempotent and
 * non-destructive: existing operator-owned rows and already-set links are left
 * intact. No-op when there are no non-archived agents.
 */
export async function projectCoworkerWorkforce(
  input: { db?: ProjectCoworkerWorkforceClient } = {},
): Promise<ProjectCoworkerWorkforceResult> {
  const db = input.db ?? (prisma as unknown as ProjectCoworkerWorkforceClient);

  const agentsRaw = (await db.agent.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
    select: {
      agentId: true,
      displayName: true,
      name: true,
      kind: true,
      status: true,
      valueStream: true,
      humanSupervisorId: true,
      portfolioId: true,
    },
  })) as CoworkerAgentRow[];

  // One coworker seeded under BOTH its slug and its canonical AGT-* id is ONE
  // coworker — and productId is keyed on agentId, so projecting both mints TWO
  // DigitalProducts with the same name for the same peer. That is worse than the
  // display duplicates fixed elsewhere in this branch: it creates duplicate ROWS
  // that then surface anywhere active products are listed (BI-74FD6420).
  const agents = agentsRaw.filter((a) => {
    const canonical = COWORKER_SLUG_TO_CANONICAL_AGENT_ID[a.agentId];
    return !(canonical && canonical !== a.agentId && agentsRaw.some((o) => o.agentId === canonical));
  });

  if (agents.length === 0) return { ...EMPTY };

  const entries = agents.map(buildEntry);
  const projection = await projectPortfolioEntries(entries, { db });

  // Resolve the for_employees portfolio id once for the Agent.portfolioId link.
  const portfolio = (await db.portfolio.findUnique({
    where: { slug: FOR_EMPLOYEES_SLUG },
    select: { id: true },
  })) as { id: string } | null;

  let agentsPortfolioLinked = 0;
  let servicesLinked = 0;

  for (const agent of agents) {
    // (a) Anchor the coworker itself to the Workforce portfolio, only when unset —
    // never move an agent an operator has already assigned elsewhere.
    if (portfolio && !agent.portfolioId) {
      await db.agent.update({
        where: { agentId: agent.agentId },
        data: { portfolioId: portfolio.id },
      });
      agentsPortfolioLinked++;
    }

    // (b) Link the coworker's services to its product, only where none is set.
    const linked = (await db.coworkerService.updateMany({
      where: { providerAgentId: agent.agentId, digitalProductId: null },
      data: { digitalProductId: coworkerProductId(agent.agentId) },
    })) as { count: number };
    servicesLinked += linked?.count ?? 0;
  }

  return {
    ...projection,
    coworkers: agents.length,
    agentsPortfolioLinked,
    servicesLinked,
  };
}
