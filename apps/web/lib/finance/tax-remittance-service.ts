import { prisma, type Prisma } from "@dpf/db";
import {
  MANAGED_TAX_ISSUE_TYPES,
  addDays,
  buildCoworkerGuide,
  buildManagedTaxIssues,
  issueKey,
  issuePublicId,
  type LiabilityDraft,
  type TaxRegistrationRecord,
} from "./tax-remittance-core";

export async function getOrCreateTaxProfile(organizationId: string) {
  const existing = await prisma.organizationTaxProfile.findFirst({
    where: { organizationId },
  });

  if (existing) return existing;

  return prisma.organizationTaxProfile.create({
    data: {
      organizationId,
      setupMode: "unknown",
      setupStatus: "draft",
      taxModel: "hybrid",
    },
  });
}

export type TaxProfileRecord = Awaited<ReturnType<typeof getOrCreateTaxProfile>>;

export async function createTaxNotification(userId: string, title: string, body: string) {
  await prisma.notification.create({
    data: {
      userId,
      type: "tax-remittance",
      title,
      body,
      deepLink: "/finance/settings/tax",
      read: false,
    },
  });
}

export async function upsertOperationalTaxIssue(input: {
  profileId: string;
  issueType: string;
  title: string;
  details: string;
  severity?: string;
  registrationId?: string | null;
  periodId?: string | null;
}) {
  const existing = await prisma.taxIssue.findMany({
    where: {
      organizationTaxProfileId: input.profileId,
      issueType: input.issueType,
      registrationId: input.registrationId ?? null,
      periodId: input.periodId ?? null,
      status: "open",
    },
  });

  const openIssue = existing[0];
  if (openIssue) {
    return prisma.taxIssue.update({
      where: { id: openIssue.id },
      data: {
        severity: input.severity ?? "high",
        title: input.title,
        details: input.details,
      },
    });
  }

  return prisma.taxIssue.create({
    data: {
      issueId: issuePublicId(),
      organizationTaxProfileId: input.profileId,
      registrationId: input.registrationId ?? null,
      periodId: input.periodId ?? null,
      issueType: input.issueType,
      severity: input.severity ?? "high",
      title: input.title,
      details: input.details,
      status: "open",
    },
  });
}

export async function resolveOperationalTaxIssue(
  issueType: string,
  registrationId?: string | null,
  periodId?: string | null,
) {
  const issues = await prisma.taxIssue.findMany({
    where: {
      issueType,
      registrationId: registrationId ?? null,
      periodId: periodId ?? null,
      status: "open",
    },
  });

  for (const issue of issues) {
    await prisma.taxIssue.update({
      where: { id: issue.id },
      data: {
        status: "resolved",
        resolvedAt: new Date(),
      },
    });
  }
}

export async function persistLiabilityDrafts(
  profileId: string,
  registrationId: string,
  periodId: string,
  drafts: LiabilityDraft[],
) {
  await prisma.taxLiabilityEntry.deleteMany({
    where: { periodId },
  });

  for (const draft of drafts) {
    let decisionSnapshotId: string | null = null;

    if (draft.snapshotId) {
      const snapshot = await prisma.taxDecisionSnapshot.upsert({
        where: { snapshotId: draft.snapshotId },
        update: {
          sourceType: draft.sourceType,
          sourceId: draft.sourceId,
          sourceLineItemId: draft.sourceLineItemId ?? null,
          taxType: draft.taxType,
          taxCode: draft.taxCode ?? null,
          direction: draft.direction,
          taxableAmount: draft.taxableAmount,
          taxRate: draft.taxRate ?? null,
          taxAmount: draft.taxAmount,
          occurredAt: draft.occurredAt,
          evidence: (draft.evidence ?? {}) as Prisma.InputJsonValue,
        },
        create: {
          snapshotId: draft.snapshotId,
          organizationTaxProfileId: profileId,
          registrationId,
          sourceType: draft.sourceType,
          sourceId: draft.sourceId,
          sourceLineItemId: draft.sourceLineItemId ?? null,
          taxType: draft.taxType,
          taxCode: draft.taxCode ?? null,
          direction: draft.direction,
          taxableAmount: draft.taxableAmount,
          taxRate: draft.taxRate ?? null,
          taxAmount: draft.taxAmount,
          jurisdictionRefId: null,
          occurredAt: draft.occurredAt,
          evidence: (draft.evidence ?? {}) as Prisma.InputJsonValue,
        },
      });
      decisionSnapshotId = snapshot.id;
    }

    await prisma.taxLiabilityEntry.upsert({
      where: { entryId: draft.entryId },
      update: {
        periodId,
        decisionSnapshotId,
        sourceType: draft.sourceType,
        sourceId: draft.sourceId,
        sourceLineItemId: draft.sourceLineItemId ?? null,
        direction: draft.direction,
        taxableAmount: draft.taxableAmount,
        taxAmount: draft.taxAmount,
        currency: draft.currency,
        notes: draft.notes ?? null,
        occurredAt: draft.occurredAt,
      },
      create: {
        entryId: draft.entryId,
        organizationTaxProfileId: profileId,
        registrationId,
        periodId,
        decisionSnapshotId,
        sourceType: draft.sourceType,
        sourceId: draft.sourceId,
        sourceLineItemId: draft.sourceLineItemId ?? null,
        direction: draft.direction,
        taxableAmount: draft.taxableAmount,
        taxAmount: draft.taxAmount,
        currency: draft.currency,
        notes: draft.notes ?? null,
        occurredAt: draft.occurredAt,
      },
    });
  }
}

export async function reconcileTaxIssues(
  profile: TaxProfileRecord,
  registrations: TaxRegistrationRecord[],
) {
  const desiredIssues = buildManagedTaxIssues(profile, registrations);
  const existingIssues = await prisma.taxIssue.findMany({
    where: { organizationTaxProfileId: profile.id },
    orderBy: [{ severity: "desc" }, { openedAt: "asc" }],
  });

  const existingByKey = new Map(
    existingIssues
      .filter((issue) => MANAGED_TAX_ISSUE_TYPES.has(issue.issueType))
      .map((issue) => [issueKey(issue.issueType, issue.registrationId, issue.periodId), issue]),
  );

  const activeIssues: Array<(typeof existingIssues)[number]> = [];
  const seenKeys = new Set<string>();

  for (const desired of desiredIssues) {
    const key = issueKey(desired.issueType, desired.registrationId, desired.periodId);
    seenKeys.add(key);
    const existing = existingByKey.get(key);

    if (existing) {
      const updated = existing.status === "open"
        && existing.title === desired.title
        && existing.details === desired.details
        && existing.severity === desired.severity
        ? existing
        : await prisma.taxIssue.update({
            where: { id: existing.id },
            data: {
              title: desired.title,
              details: desired.details,
              severity: desired.severity,
              status: "open",
              resolvedAt: null,
            },
          });
      activeIssues.push(updated);
      continue;
    }

    const created = await prisma.taxIssue.create({
      data: {
        issueId: issuePublicId(),
        organizationTaxProfileId: profile.id,
        registrationId: desired.registrationId ?? null,
        periodId: desired.periodId ?? null,
        issueType: desired.issueType,
        severity: desired.severity,
        status: "open",
        title: desired.title,
        details: desired.details,
      },
    });
    activeIssues.push(created);
  }

  for (const existing of existingIssues) {
    if (!MANAGED_TAX_ISSUE_TYPES.has(existing.issueType)) continue;
    const key = issueKey(existing.issueType, existing.registrationId, existing.periodId);
    if (seenKeys.has(key) || existing.status === "resolved") continue;
    await prisma.taxIssue.update({
      where: { id: existing.id },
      data: {
        status: "resolved",
        resolvedAt: new Date(),
      },
    });
  }

  return activeIssues.sort((left, right) => {
    if (left.severity === right.severity) {
      return left.title.localeCompare(right.title);
    }
    return left.severity.localeCompare(right.severity);
  });
}

/**
 * Which countries' authorities the jurisdiction picker should offer.
 *
 * Returns undefined (no filter) when the install has not declared a home
 * country — narrowing on an unknown would hide authorities the operator needs.
 */
export function jurisdictionCountryScope(
  profile: { homeCountryCode?: string | null },
  registeredCountryCodes: readonly string[],
): { countryCode: { in: string[] } } | undefined {
  const home = profile.homeCountryCode?.trim().toUpperCase();
  if (!home) return undefined;

  const codes = new Set<string>([home]);
  for (const code of registeredCountryCodes) {
    const trimmed = code?.trim().toUpperCase();
    if (trimmed) codes.add(trimmed);
  }
  return { countryCode: { in: [...codes].sort() } };
}

export async function loadTaxWorkspaceState(profile: TaxProfileRecord, ownerUserId: string) {
  // Resolved BEFORE the parallel reads: the jurisdiction picker's scope depends
  // on which countries this org already holds registrations in, so it cannot be
  // computed inside the same Promise.all that fetches them.
  const registeredCountries = await prisma.taxRegistration.findMany({
    where: { organizationTaxProfileId: profile.id },
    select: { jurisdictionReference: { select: { countryCode: true } } },
  });
  const registeredCountryCodes = registeredCountries
    .map((row) => row.jurisdictionReference?.countryCode)
    .filter((code): code is string => Boolean(code));

  const [registrations, periods, jurisdictionOptions, monitoringTask, rawAuthorityCredentials] = await Promise.all([
    prisma.taxRegistration.findMany({
      where: { organizationTaxProfileId: profile.id },
      include: {
        jurisdictionReference: {
          select: {
            id: true,
            jurisdictionRefId: true,
            authorityName: true,
            countryCode: true,
            stateProvinceCode: true,
            authorityType: true,
            taxTypes: true,
          },
        },
      },
      orderBy: [{ registrationStatus: "asc" }, { createdAt: "asc" }],
    }),
    prisma.taxObligationPeriod.findMany({
      where: {
        registration: {
          organizationTaxProfileId: profile.id,
        },
      },
      include: {
        components: { select: { componentKind: true, amount: true } },
        registration: {
          include: {
            jurisdictionReference: {
              select: {
                authorityName: true,
                jurisdictionRefId: true,
                countryCode: true,
                stateProvinceCode: true,
              },
            },
          },
        },
        artifacts: {
          orderBy: { createdAt: "desc" },
        },
        liabilityEntries: {
          orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
        },
        remittanceRuns: {
          orderBy: [{ createdAt: "desc" }],
        },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 12,
    }),
    prisma.taxJurisdictionReference.findMany({
      // Scope the catalogue to where this install actually operates.
      //
      // The reference table is a GLOBAL catalogue — 50 US states, every EU
      // country, GB, and the US federal authority. Offering all of it to every
      // install meant a US business was shown EU VAT authorities and a UK
      // business all 50 US states: 80 options in one control, against a budget
      // of 20. OrganizationTaxProfile.homeCountryCode is the canonical answer to
      // where an install operates (DI-89F317F406AA), so use it rather than
      // inventing a second one.
      //
      // Countries the org ALREADY holds a registration in are always included,
      // so a cross-border obligation someone has already set up can never
      // disappear from the picker. An unset homeCountryCode falls back to the
      // whole catalogue — an install that has not declared where it operates
      // must not be silently narrowed.
      where: jurisdictionCountryScope(profile, registeredCountryCodes),
      orderBy: [{ countryCode: "asc" }, { stateProvinceCode: "asc" }, { authorityName: "asc" }],
      take: 200,
      select: {
        id: true,
        jurisdictionRefId: true,
        authorityName: true,
        countryCode: true,
        stateProvinceCode: true,
        authorityType: true,
        taxTypes: true,
      },
    }),
    prisma.scheduledAgentTask.findFirst({
      where: {
        ownerUserId,
        routeContext: "/finance/settings/tax",
        title: "Tax Remittance Monitor",
      },
      select: {
        taskId: true,
        title: true,
        schedule: true,
        isActive: true,
        nextRunAt: true,
        lastRunAt: true,
        lastStatus: true,
      },
    }),
    prisma.taxAuthorityCredential.findMany({
      where: { organizationTaxProfileId: profile.id },
      select: {
        id: true,
        credentialId: true,
        registrationId: true,
        authorityName: true,
        portalBaseUrl: true,
        credentialOwnerMode: true,
        status: true,
        authMode: true,
        secretRef: true,
        mfaMode: true,
        lastVerifiedAt: true,
        lastFailureAt: true,
        lastFailureReason: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: "desc" }],
    }),
  ]);

  const authorityCredentials = rawAuthorityCredentials.map(({ secretRef, ...credential }) => ({
    ...credential,
    hasSecret: Boolean(secretRef),
  }));

  const openIssues = await reconcileTaxIssues(profile, registrations);
  const coworkerGuide = buildCoworkerGuide(profile, registrations, openIssues);
  const now = new Date();
  const dueSoonCount = periods.filter((period) => {
    if (["filed", "paid"].includes(period.status)) return false;
    const dueDate = new Date(period.dueDate);
    return dueDate >= now && dueDate <= addDays(now, 14);
  }).length;
  const overdueCount = periods.filter((period) => {
    if (["filed", "paid"].includes(period.status)) return false;
    return new Date(period.dueDate) < now;
  }).length;

  return {
    registrations,
    periods,
    jurisdictionOptions,
    openIssues,
    authorityCredentials,
    coworkerGuide,
    monitoring: {
      dueSoonCount,
      overdueCount,
      monitoringTask,
    },
  };
}
