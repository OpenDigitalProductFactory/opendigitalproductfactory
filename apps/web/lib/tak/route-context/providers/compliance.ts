// apps/web/lib/tak/route-context/providers/compliance.ts
// Compliance & licensing-readiness page-context providers.
// Extracted verbatim from route-context.ts (page-owned context contract,
// design spec 2026-08-05 Phase 2 PR 2). Behavior unchanged.

import { prisma } from "@dpf/db";

export async function getLicensingReadinessContext(): Promise<string> {
  const profile = await prisma.organizationLicenseProfile.findFirst({
    orderBy: { createdAt: "asc" },
    select: {
      setupStatus: true,
      investigationMode: true,
      homeCountryCode: true,
      primaryRegionCode: true,
      operatingFootprintSummary: true,
      legalActivityConfidence: true,
      researchCoverageStatus: true,
      notes: true,
    },
  });

  const requirementWhere = profile?.homeCountryCode
    ? {
        OR: [
          { countryCode: profile.homeCountryCode },
          ...(profile.primaryRegionCode ? [{ stateProvinceCode: profile.primaryRegionCode }] : []),
        ],
      }
    : undefined;

  const [storefrontConfig, organizationLicenseCount, personLicenseCount, openIssueCount, requirementHints] =
    await Promise.all([
      prisma.storefrontConfig.findFirst({
        include: {
          archetype: {
            select: {
              name: true,
              category: true,
              ctaType: true,
            },
          },
        },
      }),
      prisma.organizationLicenseRecord.count(),
      prisma.personLicenseRecord.count(),
      prisma.licenseReadinessIssue.count({ where: { status: "open" } }),
      prisma.licenseRequirementReference.findMany({
        where: requirementWhere,
        select: {
          authorityName: true,
          jurisdictionLabel: true,
          requirementType: true,
          scopeLevel: true,
        },
        orderBy: [{ countryCode: "asc" }, { stateProvinceCode: "asc" }, { authorityName: "asc" }],
        take: 6,
      }),
    ]);

  const sections: string[] = ["\nPAGE DATA — Licensing Readiness:"];

  if (storefrontConfig?.archetype) {
    sections.push(
      `Business archetype: ${storefrontConfig.archetype.name}`,
      `Archetype category: ${storefrontConfig.archetype.category}`,
      `Primary public CTA: ${storefrontConfig.archetype.ctaType}`,
    );
  }

  if (!profile) {
    sections.push(
      "No licensing profile exists yet.",
      `Organization-held license records: ${organizationLicenseCount}`,
      `Person-held credential records: ${personLicenseCount}`,
      `Open licensing issues: ${openIssueCount}`,
    );
  } else {
    sections.push(
      `Setup status: ${profile.setupStatus}`,
      `Investigation mode: ${profile.investigationMode}`,
      `Home jurisdiction: ${profile.homeCountryCode ?? "unassigned"}${profile.primaryRegionCode ? ` / ${profile.primaryRegionCode}` : ""}`,
      `Legal activity confidence: ${profile.legalActivityConfidence}`,
      `Research coverage: ${profile.researchCoverageStatus}`,
      `Organization-held license records: ${organizationLicenseCount}`,
      `Person-held credential records: ${personLicenseCount}`,
      `Open licensing issues: ${openIssueCount}`,
    );

    if (profile.operatingFootprintSummary) {
      sections.push(`Operating footprint summary: ${profile.operatingFootprintSummary}`);
    }
    if (profile.notes) {
      sections.push(`Current notes: ${profile.notes}`);
    }
  }

  if (requirementHints.length > 0) {
    sections.push(
      "",
      "Requirement reference hints:",
      ...requirementHints.map(
        (item) =>
          `- ${item.authorityName} (${item.jurisdictionLabel}) — ${item.requirementType}, scope=${item.scopeLevel}`,
      ),
    );
  }

  return sections.join("\n");
}
export async function getComplianceContext(_userId: string, routeContext: string): Promise<string> {
  const sections: string[] = ["\nPAGE DATA — Compliance:"];

  // Extract entity ID from route like /compliance/regulations/cmmwfe... or /compliance/obligations/xxx
  const parts = routeContext.replace(/^\/compliance\/?/, "").split("/");
  const subPage = parts[0] ?? "";
  const entityId = parts[1];

  if (subPage === "regulations" && entityId) {
    // Regulation detail page — load the full regulation with obligations
    const regulation = await prisma.regulation.findUnique({
      where: { id: entityId },
      include: {
        obligations: {
          where: { status: "active" },
          orderBy: { reference: "asc" },
          include: {
            controls: {
              include: {
                control: { select: { title: true, implementationStatus: true, controlType: true } },
              },
            },
          },
        },
      },
    });

    if (regulation) {
      sections.push(
        `You are viewing: ${regulation.name} (${regulation.shortName})`,
        `Regulation ID: ${regulation.regulationId}`,
        `Jurisdiction: ${regulation.jurisdiction}, Industry: ${regulation.industry ?? "cross-industry"}`,
        `Status: ${regulation.status}, Effective: ${regulation.effectiveDate?.toISOString().split("T")[0] ?? "N/A"}`,
        regulation.sourceUrl ? `Source: ${regulation.sourceUrl}` : "",
        regulation.notes ? `Notes: ${regulation.notes}` : "",
        "",
        `Obligations (${regulation.obligations.length}):`,
      );

      for (const obl of regulation.obligations) {
        const controlCount = obl.controls.length;
        const implCount = obl.controls.filter(
          (l) => l.control.implementationStatus === "implemented",
        ).length;
        const coverage = controlCount === 0 ? "NO CONTROLS" : implCount > 0 ? "COVERED" : "PARTIAL (planned)";
        sections.push(
          `- ${obl.reference ?? obl.obligationId}: ${obl.title} [${coverage}, ${controlCount} controls]`,
        );
      }
    }
  } else if (subPage === "obligations" && entityId) {
    const obligation = await prisma.obligation.findUnique({
      where: { id: entityId },
      include: {
        regulation: { select: { shortName: true, regulationId: true } },
        controls: {
          include: { control: { select: { title: true, controlType: true, implementationStatus: true } } },
        },
      },
    });
    if (obligation) {
      sections.push(
        `You are viewing obligation: ${obligation.title}`,
        `Reference: ${obligation.reference}, Regulation: ${obligation.regulation.shortName}`,
        `Category: ${obligation.category}, Frequency: ${obligation.frequency}`,
        `Controls (${obligation.controls.length}):`,
        ...obligation.controls.map((l) => `- ${l.control.title} [${l.control.controlType}, ${l.control.implementationStatus}]`),
      );
    }
  } else if (subPage === "controls" && entityId) {
    const control = await prisma.control.findUnique({
      where: { id: entityId },
      include: {
        obligations: {
          include: { obligation: { select: { title: true, reference: true, obligationId: true } } },
        },
      },
    });
    if (control) {
      sections.push(
        `You are viewing control: ${control.title}`,
        `Type: ${control.controlType}, Status: ${control.implementationStatus}, Effectiveness: ${control.effectiveness ?? "not assessed"}`,
        `Linked obligations (${control.obligations.length}):`,
        ...control.obligations.map((l) => `- ${l.obligation.reference ?? l.obligation.obligationId}: ${l.obligation.title}`),
      );
    }
  } else {
    // Dashboard or list pages — provide summary
    const [regCount, oblCount, controlCount, implCount, openIncidents, pendingAlerts] = await Promise.all([
      prisma.regulation.count({ where: { status: "active" } }),
      prisma.obligation.count({ where: { status: "active" } }),
      prisma.control.count({ where: { status: "active" } }),
      prisma.control.count({ where: { status: "active", implementationStatus: "implemented" } }),
      prisma.complianceIncident.count({ where: { status: { in: ["open", "investigating"] } } }),
      prisma.regulatoryAlert.count({ where: { status: "pending" } }),
    ]);

    const regulations = await prisma.regulation.findMany({
      where: { status: "active" },
      select: { shortName: true, jurisdiction: true, _count: { select: { obligations: true } } },
      orderBy: { shortName: "asc" },
    });

    sections.push(
      `Summary: ${regCount} regulations, ${oblCount} obligations, ${controlCount} controls (${implCount} implemented), ${openIncidents} open incidents, ${pendingAlerts} pending alerts`,
      "",
      "Registered regulations:",
      ...regulations.map((r) => `- ${r.shortName} (${r.jurisdiction}) — ${r._count.obligations} obligations`),
    );
  }

  return sections.filter(Boolean).join("\n");
}
