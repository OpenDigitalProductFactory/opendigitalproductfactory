"use server";

import { prisma } from "@dpf/db";
import { newId } from "@/lib/shared/new-id";
import {
  netFromComponents,
  summariseComponents,
  upsertPeriodWithComponents,
} from "@/lib/finance/tax-period-components";
import { applyOrgCountry } from "@/lib/actions/currency";
import { auth } from "@/lib/auth";
import { encryptSecret } from "@/lib/govern/credential-crypto";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import {
  addDays,
  addMonths,
  appendNote,
  buildBillLiabilityDrafts,
  buildFilingPacketNotes,
  buildInvoiceLiabilityDrafts,
  computeNextCronRun,
  credentialPublicId,
  decimalValue,
  nullableString,
  periodMonthsForFrequency,
  periodPublicId,
  registrationPublicId,
  remittanceRunPublicId,
  roundCurrency,
  stableTaxEntityId,
  taxExecutionTaskId,
  taxMonitorTaskId,
  type LiabilityDraft,
} from "@/lib/finance/tax-remittance-core";
import {
  createTaxNotification,
  getOrCreateTaxProfile,
  loadTaxWorkspaceState,
  persistLiabilityDrafts,
  reconcileTaxIssues,
  resolveOperationalTaxIssue,
  upsertOperationalTaxIssue,
} from "@/lib/finance/tax-remittance-service";
import {
  addTaxFilingArtifactSchema,
  createTaxRegistrationSchema,
  prepareTaxFilingPacketSchema,
  prepareTaxRemittanceRunSchema,
  saveTaxAuthorityCredentialSchema,
  updateOrganizationTaxProfileSchema,
  updateTaxRemittanceRunStatusSchema,
  verifyTaxRegistrationSchema,
  type AddTaxFilingArtifactInput,
  type CreateTaxRegistrationInput,
  type PrepareTaxFilingPacketInput,
  type PrepareTaxRemittanceRunInput,
  type SaveTaxAuthorityCredentialInput,
  type UpdateOrganizationTaxProfileInput,
  type UpdateTaxRemittanceRunStatusInput,
  type VerifyTaxRegistrationInput,
} from "@/lib/finance/tax-remittance-validation";

async function requireManageFinance() {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_finance")
  ) {
    throw new Error("Unauthorized");
  }
  return user;
}

async function requireOrganization() {
  const organization = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!organization) {
    throw new Error("No organization configured");
  }

  return organization;
}

function revalidateTaxRoutes() {
  revalidatePath("/finance");
  revalidatePath("/finance/settings");
  revalidatePath("/finance/settings/tax");
  revalidatePath("/finance/configuration");
}

export async function getTaxRemittanceWorkspace() {
  const user = await requireManageFinance();

  const organization = await requireOrganization();
  const profile = await getOrCreateTaxProfile(organization.id);
  const workspaceState = await loadTaxWorkspaceState(profile, user.id);

  return {
    organization,
    profile,
    ...workspaceState,
  };
}

export async function updateOrganizationTaxProfile(input: UpdateOrganizationTaxProfileInput) {
  await requireManageFinance();
  const organization = await requireOrganization();
  const profile = await getOrCreateTaxProfile(organization.id);
  const parsed = updateOrganizationTaxProfileSchema.parse(input);

  const updated = await prisma.organizationTaxProfile.update({
    where: { id: profile.id },
    data: {
      setupMode: parsed.setupMode,
      setupStatus: parsed.setupStatus,
      homeCountryCode: nullableString(parsed.homeCountryCode),
      primaryRegionCode: nullableString(parsed.primaryRegionCode),
      taxModel: parsed.taxModel,
      filingOwner: parsed.filingOwner,
      handoffMode: parsed.handoffMode,
      externalSystem: nullableString(parsed.externalSystem),
      footprintSummary: nullableString(parsed.footprintSummary),
      notes: nullableString(parsed.notes),
    },
  });
  await applyOrgCountry(updated.homeCountryCode).catch(() => null); // EP-ORG-LOCALE-CURRENCY: sync org currency/locale from the captured home country (non-fatal)

  const registrations = await prisma.taxRegistration.findMany({
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
  });
  await reconcileTaxIssues(updated, registrations);

  revalidateTaxRoutes();
  return updated;
}

export async function createTaxRegistration(input: CreateTaxRegistrationInput) {
  await requireManageFinance();
  const organization = await requireOrganization();
  const profile = await getOrCreateTaxProfile(organization.id);
  const parsed = createTaxRegistrationSchema.parse(input);

  const created = await prisma.taxRegistration.create({
    data: {
      registrationId: registrationPublicId(),
      organizationTaxProfileId: profile.id,
      jurisdictionReferenceId: parsed.jurisdictionReferenceId,
      taxType: parsed.taxType,
      registrationNumber: nullableString(parsed.registrationNumber),
      registrationStatus: parsed.registrationStatus,
      filingFrequency: parsed.filingFrequency,
      filingBasis: nullableString(parsed.filingBasis),
      remitterRole: parsed.remitterRole,
      effectiveFrom: new Date(parsed.effectiveFrom),
      firstPeriodStart: new Date(parsed.effectiveFrom),
      portalAccountNotes: nullableString(parsed.portalAccountNotes),
      confidence: "medium",
    },
  });

  const registrations = await prisma.taxRegistration.findMany({
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
  });
  await reconcileTaxIssues(profile, registrations);

  revalidateTaxRoutes();
  return created;
}

export async function verifyTaxRegistration(input: VerifyTaxRegistrationInput) {
  await requireManageFinance();
  const parsed = verifyTaxRegistrationSchema.parse(input);

  const registration = await prisma.taxRegistration.findFirst({
    where: { id: parsed.registrationId },
  });

  if (!registration) {
    throw new Error("Tax registration not found.");
  }

  const updated = await prisma.taxRegistration.update({
    where: { id: registration.id },
    data: {
      verifiedFromSourceUrl: parsed.verifiedFromSourceUrl,
      lastVerifiedAt: new Date(),
      confidence: parsed.confidence,
      portalAccountNotes: appendNote(registration.portalAccountNotes, parsed.portalAccountNotes),
    },
  });

  const profile = await prisma.organizationTaxProfile.findFirst({
    where: { id: registration.organizationTaxProfileId },
  });

  if (profile) {
    const registrations = await prisma.taxRegistration.findMany({
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
    });
    await reconcileTaxIssues(profile, registrations);
  } else {
    const matchingIssues = await prisma.taxIssue.findMany({
      where: {
        registrationId: registration.id,
        issueType: "tax_registration_live_verification_needed",
      },
    });
    for (const issue of matchingIssues) {
      if (issue.status === "resolved") continue;
      await prisma.taxIssue.update({
        where: { id: issue.id },
        data: {
          status: "resolved",
          resolvedAt: new Date(),
        },
      });
    }
  }

  revalidateTaxRoutes();
  return updated;
}

export async function generateTaxObligationPeriods() {
  await requireManageFinance();
  const organization = await requireOrganization();
  const profile = await getOrCreateTaxProfile(organization.id);
  const registrations = await prisma.taxRegistration.findMany({
    where: {
      organizationTaxProfileId: profile.id,
      registrationStatus: "active",
      lastVerifiedAt: {
        not: null,
      },
    },
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
    orderBy: { effectiveFrom: "asc" },
  });

  const generatedPeriods: Array<{ id: string; periodId: string }> = [];
  const canSummarizeOrgTax = registrations.length === 1;
  const generationBoundary = new Date();

  for (const registration of registrations) {
    const monthsPerPeriod = periodMonthsForFrequency(registration.filingFrequency);
    if (!monthsPerPeriod) continue;

    let periodStart = registration.firstPeriodStart ?? registration.effectiveFrom;
    let iterationCount = 0;

    while (periodStart <= generationBoundary && iterationCount < 6) {
      const nextStart = addMonths(periodStart, monthsPerPeriod);
      const periodEnd = addDays(nextStart, -1);
      const dueDate = addDays(periodEnd, 30);

      const existing = await prisma.taxObligationPeriod.findFirst({
        where: {
          registrationId: registration.id,
          periodStart,
          periodEnd,
        },
      });

      const manualAdjustmentAmount = existing ? roundCurrency(decimalValue(existing.manualAdjustmentAmount)) : 0;
      const liabilityDrafts: LiabilityDraft[] = [];

      if (canSummarizeOrgTax) {
        const [invoices, bills] = await Promise.all([
          prisma.invoice.findMany({
            where: {
              status: {
                notIn: ["draft", "void"],
              },
              issueDate: {
                gte: periodStart,
                lte: periodEnd,
              },
            },
            select: {
              id: true,
              invoiceRef: true,
              type: true,
              currency: true,
              issueDate: true,
              lineItems: {
                select: {
                  id: true,
                  description: true,
                  lineTotal: true,
                  taxRate: true,
                  taxAmount: true,
                },
                orderBy: { sortOrder: "asc" },
              },
            },
          }),
          prisma.bill.findMany({
            where: {
              status: {
                notIn: ["draft", "void"],
              },
              issueDate: {
                gte: periodStart,
                lte: periodEnd,
              },
            },
            select: {
              id: true,
              billRef: true,
              currency: true,
              issueDate: true,
              lineItems: {
                select: {
                  id: true,
                  description: true,
                  lineTotal: true,
                  taxRate: true,
                  taxAmount: true,
                },
                orderBy: { sortOrder: "asc" },
              },
            },
          }),
        ]);

        liabilityDrafts.push(...buildInvoiceLiabilityDrafts(registration, invoices));
        liabilityDrafts.push(...buildBillLiabilityDrafts(registration, bills));
      }

      if (manualAdjustmentAmount !== 0) {
        liabilityDrafts.push({
          entryId: stableTaxEntityId("TAX-LIAB", registration.id, "manual_adjustment", periodStart, periodEnd),
          sourceType: "manual_adjustment",
          sourceId: existing?.id ?? stableTaxEntityId("TAX-PERIOD", registration.id, periodStart, periodEnd),
          sourceLineItemId: null,
          direction: "adjustment",
          taxType: registration.taxType,
          taxCode: "manual_adjustment",
          taxableAmount: 0,
          taxRate: null,
          taxAmount: manualAdjustmentAmount,
          currency: "GBP",
          occurredAt: dueDate,
          notes: "Manual period adjustment carried on the obligation period.",
        });
      }

      const salesTaxAmount = roundCurrency(
        liabilityDrafts
          .filter((draft) => draft.direction === "output")
          .reduce((sum, draft) => sum + draft.taxAmount, 0),
      );
      const inputTaxAmount = roundCurrency(
        liabilityDrafts
          .filter((draft) => draft.direction === "input")
          .reduce((sum, draft) => sum + draft.taxAmount, 0),
      );
      const adjustmentAmount = roundCurrency(
        liabilityDrafts
          .filter((draft) => draft.direction === "adjustment")
          .reduce((sum, draft) => sum + draft.taxAmount, 0),
      );
      const periodComponents = [
        { componentKind: "sales_output" as const, amount: salesTaxAmount },
        { componentKind: "sales_input" as const, amount: inputTaxAmount },
      ];
      const netTaxAmount = netFromComponents(
        summariseComponents(periodComponents),
        adjustmentAmount,
      );

      const period = await upsertPeriodWithComponents(prisma as never, {
        existingRecordId: existing?.id,
        registrationId: registration.id,
        newPeriodId: periodPublicId,
        newComponentId: () => `TPC-${newId()}`,
        periodStart,
        periodEnd,
        dueDate,
        netTaxAmount,
        manualAdjustmentAmount,
        components: periodComponents,
      });
      const periodRecordId = period.id;
      generatedPeriods.push({ id: period.id, periodId: period.periodId ?? existing!.periodId });

      await persistLiabilityDrafts(profile.id, registration.id, periodRecordId, liabilityDrafts);

      periodStart = nextStart;
      iterationCount += 1;
      if (registration.effectiveTo && periodStart > registration.effectiveTo) {
        break;
      }
    }
  }

  revalidateTaxRoutes();
  return generatedPeriods;
}

export async function reviewTaxDeadlineNotifications() {
  const user = await requireManageFinance();
  const organization = await requireOrganization();
  const profile = await getOrCreateTaxProfile(organization.id);
  const now = new Date();
  const dueSoonBoundary = addDays(now, 14);

  const periods = await prisma.taxObligationPeriod.findMany({
    where: {
      registration: {
        organizationTaxProfileId: profile.id,
      },
      status: {
        notIn: ["filed", "paid"],
      },
      dueDate: {
        lte: dueSoonBoundary,
      },
    },
    include: {
      registration: {
        include: {
          jurisdictionReference: {
            select: {
              authorityName: true,
              countryCode: true,
              stateProvinceCode: true,
            },
          },
        },
      },
    },
    orderBy: { dueDate: "asc" },
  });

  let notificationsCreated = 0;

  for (const period of periods) {
    const dueDate = new Date(period.dueDate);
    const authorityName = period.registration.jurisdictionReference.authorityName;

    if (dueDate < now && !period.overdueNotifiedAt) {
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: "tax-remittance",
          title: `Overdue tax remittance: ${authorityName}`,
          body: `${period.periodId} is overdue for filing or payment. Review the tax remittance workspace and resolve the blocked period immediately.`,
          deepLink: "/finance/settings/tax",
          read: false,
        },
      });
      await prisma.taxObligationPeriod.update({
        where: { id: period.id },
        data: { overdueNotifiedAt: now },
      });
      notificationsCreated += 1;
      continue;
    }

    if (dueDate >= now && !period.dueSoonNotifiedAt) {
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: "tax-remittance",
          title: `Upcoming tax remittance: ${authorityName}`,
          body: `${period.periodId} is due on ${dueDate.toISOString().slice(0, 10)}. Review the filing packet, evidence, and handoff status now.`,
          deepLink: "/finance/settings/tax",
          read: false,
        },
      });
      await prisma.taxObligationPeriod.update({
        where: { id: period.id },
        data: { dueSoonNotifiedAt: now },
      });
      notificationsCreated += 1;
    }
  }

  revalidateTaxRoutes();
  return { notificationsCreated };
}

export async function ensureTaxDeadlineMonitoringTask() {
  const user = await requireManageFinance();

  const existing = await prisma.scheduledAgentTask.findFirst({
    where: {
      ownerUserId: user.id,
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
  });

  if (existing) {
    return { created: false, task: existing };
  }

  const schedule = "0 8 * * *";
  const nextRunAt = computeNextCronRun(schedule, new Date());
  const taskId = taxMonitorTaskId();

  const task = await prisma.scheduledAgentTask.create({
    data: {
      taskId,
      agentId: "finance-agent",
      title: "Tax Remittance Monitor",
      prompt:
        "Review tax remittance periods due in the next 14 days or already overdue. Highlight blocked filings, missing evidence, and missing external handoff details, then summarize what needs attention.",
      routeContext: "/finance/settings/tax",
      schedule,
      timezone: "America/Chicago",
      ownerUserId: user.id,
      nextRunAt,
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
  });

  await prisma.scheduledJob.upsert({
    where: { jobId: taskId },
    create: {
      jobId: taskId,
      name: "Agent: Tax Remittance Monitor",
      schedule,
      nextRunAt,
    },
    update: {
      name: "Agent: Tax Remittance Monitor",
      schedule,
      nextRunAt,
    },
  });

  revalidateTaxRoutes();
  return { created: true, task };
}

export async function prepareTaxFilingPacket(input: PrepareTaxFilingPacketInput) {
  const user = await requireManageFinance();
  const parsed = prepareTaxFilingPacketSchema.parse(input);

  const period = await prisma.taxObligationPeriod.findFirst({
    where: { id: parsed.periodId },
    include: {
      components: { select: { componentKind: true, amount: true } },
      registration: {
        include: {
          jurisdictionReference: {
            select: {
              authorityName: true,
            },
          },
        },
      },
    },
  });

  if (!period) {
    throw new Error("Tax obligation period not found.");
  }

  const artifact = await prisma.taxFilingArtifact.create({
    data: {
      periodId: period.id,
      artifactType: "workpaper",
      notes: buildFilingPacketNotes(period),
      createdByUserId: user.id,
    },
  });

  await prisma.taxObligationPeriod.update({
    where: { id: period.id },
    data: {
      status: "ready",
      exportStatus: "prepared",
    },
  });

  revalidateTaxRoutes();
  return artifact;
}

export async function saveTaxAuthorityCredential(input: SaveTaxAuthorityCredentialInput) {
  await requireManageFinance();
  const parsed = saveTaxAuthorityCredentialSchema.parse(input);

  const registration = await prisma.taxRegistration.findFirst({
    where: { id: parsed.registrationId },
    include: {
      jurisdictionReference: {
        select: {
          authorityName: true,
        },
      },
    },
  });

  if (!registration) {
    throw new Error("Tax registration not found.");
  }

  const encryptedSecret = parsed.secretRef ? encryptSecret(parsed.secretRef) : undefined;
  const existing = await prisma.taxAuthorityCredential.findFirst({
    where: { registrationId: registration.id },
  });

  const payload = {
    authorityName: registration.jurisdictionReference.authorityName,
    portalBaseUrl: nullableString(parsed.portalBaseUrl),
    credentialOwnerMode: parsed.credentialOwnerMode,
    status: parsed.status,
    authMode: parsed.authMode,
    ...(encryptedSecret !== undefined ? { secretRef: encryptedSecret } : {}),
    mfaMode: parsed.mfaMode,
    notes: nullableString(parsed.notes),
    lastVerifiedAt: parsed.status === "active" ? new Date() : null,
    ...(parsed.status === "blocked"
      ? { lastFailureAt: new Date(), lastFailureReason: "Credential blocked during finance setup." }
      : {}),
  };

  const credential = existing
    ? await prisma.taxAuthorityCredential.update({
        where: { id: existing.id },
        data: payload,
      })
    : await prisma.taxAuthorityCredential.create({
        data: {
          credentialId: credentialPublicId(),
          organizationTaxProfileId: registration.organizationTaxProfileId,
          registrationId: registration.id,
          ...payload,
        },
      });

  if (parsed.status === "active") {
    await resolveOperationalTaxIssue("tax_execution_credential_missing", registration.id, null);
  } else if (parsed.status === "blocked") {
    await upsertOperationalTaxIssue({
      profileId: registration.organizationTaxProfileId,
      issueType: "tax_execution_credential_missing",
      registrationId: registration.id,
      title: `${registration.jurisdictionReference.authorityName} credential needs attention`,
      details: "Execution cannot proceed until a valid authority credential is available.",
      severity: "high",
    });
  }

  revalidateTaxRoutes();
  return credential;
}

export async function prepareTaxRemittanceRun(input: PrepareTaxRemittanceRunInput) {
  const user = await requireManageFinance();
  const parsed = prepareTaxRemittanceRunSchema.parse(input);

  const period = await prisma.taxObligationPeriod.findFirst({
    where: { id: parsed.periodId },
    include: {
      registration: {
        include: {
          jurisdictionReference: {
            select: {
              authorityName: true,
            },
          },
        },
      },
    },
  });

  if (!period) {
    throw new Error("Tax obligation period not found.");
  }

  const credential = await prisma.taxAuthorityCredential.findFirst({
    where: {
      registrationId: period.registrationId,
      status: "active",
    },
  });

  const scheduledFor = parsed.scheduleFor ? new Date(parsed.scheduleFor) : null;
  const missingCredential = parsed.executionMode === "scheduled_coworker" && !credential;

  const run = await prisma.taxRemittanceRun.create({
    data: {
      runId: remittanceRunPublicId(),
      periodId: period.id,
      credentialId: credential?.id ?? null,
      status: missingCredential ? "blocked" : parsed.executionMode === "scheduled_coworker" ? "scheduled" : "draft",
      executionMode: parsed.executionMode,
      scheduledFor,
      createdByAgentId: parsed.executionMode === "scheduled_coworker" ? "finance-agent" : null,
      createdByUserId: user.id,
      failureCode: missingCredential ? "missing_credential" : null,
      failureDetails: missingCredential
        ? `Execution is blocked because ${period.registration.jurisdictionReference.authorityName} has no active authority credential.`
        : null,
    },
  });

  if (missingCredential) {
    await upsertOperationalTaxIssue({
      profileId: period.registration.organizationTaxProfileId,
      issueType: "tax_execution_credential_missing",
      registrationId: period.registrationId,
      periodId: period.id,
      title: `${period.registration.jurisdictionReference.authorityName} execution is blocked`,
      details: "A valid authority credential is required before the coworker can file or pay this period.",
      severity: "high",
    });
    await createTaxNotification(
      user.id,
      `Tax execution blocked: ${period.registration.jurisdictionReference.authorityName}`,
      `${period.periodId} cannot be scheduled for coworker execution because no active authority credential is recorded.`,
    );
    revalidateTaxRoutes();
    return run;
  }

  // EP-SCHEDULING-SURFACE / BI-SCHED-DORMANT: TaxRemittanceRun.scheduledFor is NOT
  // polled by a central cron. A scheduled run is dispatched here as a one-shot
  // ScheduledAgentTask (nextRunAt = scheduledFor), so it rides the agent-task
  // substrate pumped by agent/task-dispatch. Intentional — do not add a tax poller.
  if (parsed.executionMode === "scheduled_coworker" && scheduledFor) {
    const taskId = taxExecutionTaskId();
    const schedule = `${scheduledFor.getUTCMinutes()} ${scheduledFor.getUTCHours()} ${scheduledFor.getUTCDate()} ${scheduledFor.getUTCMonth() + 1} *`;

    await prisma.scheduledAgentTask.create({
      data: {
        taskId,
        agentId: "finance-agent",
        title: `Tax remittance execution ${period.periodId}`,
        prompt: `Review tax remittance run ${run.runId} for ${period.periodId}. If credentials and evidence remain valid, submit the filing package and record the outcome. If anything is blocked, update the run with the failure reason and raise the appropriate issue.`,
        routeContext: "/finance/settings/tax",
        schedule,
        timezone: "America/Chicago",
        ownerUserId: user.id,
        nextRunAt: scheduledFor,
      },
    });

    await prisma.scheduledJob.upsert({
      where: { jobId: taskId },
      create: {
        jobId: taskId,
        name: `Agent: Tax remittance execution ${period.periodId}`,
        schedule,
        nextRunAt: scheduledFor,
      },
      update: {
        name: `Agent: Tax remittance execution ${period.periodId}`,
        schedule,
        nextRunAt: scheduledFor,
      },
    });
  }

  await resolveOperationalTaxIssue("tax_execution_credential_missing", period.registrationId, period.id);
  revalidateTaxRoutes();
  return run;
}

export async function updateTaxRemittanceRunStatus(input: UpdateTaxRemittanceRunStatusInput) {
  const user = await requireManageFinance();
  const parsed = updateTaxRemittanceRunStatusSchema.parse(input);

  const run = await prisma.taxRemittanceRun.findFirst({
    where: { id: parsed.runId },
    include: {
      period: {
        include: {
          registration: {
            include: {
              jurisdictionReference: {
                select: {
                  authorityName: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!run) {
    throw new Error("Tax remittance run not found.");
  }

  const now = new Date();
  const updateData: Record<string, unknown> = {
    status: parsed.status,
    confirmationRef: nullableString(parsed.confirmationRef),
    failureCode: nullableString(parsed.failureCode),
    failureDetails: nullableString(parsed.failureDetails),
  };

  if (parsed.status === "submitted") {
    updateData.submittedAt = now;
  }
  if (parsed.status === "paid") {
    updateData.paidAt = now;
    updateData.completedAt = now;
  }
  if (parsed.status === "failed" || parsed.status === "blocked") {
    updateData.completedAt = now;
  }

  const updated = await prisma.taxRemittanceRun.update({
    where: { id: run.id },
    data: updateData,
  });

  if (parsed.status === "submitted") {
    await prisma.taxObligationPeriod.update({
      where: { id: run.periodId },
      data: {
        status: "filed",
        filedAt: now,
        confirmationRef: nullableString(parsed.confirmationRef),
      },
    });
    await resolveOperationalTaxIssue("tax_execution_failed", run.period.registrationId, run.periodId);
    await createTaxNotification(
      user.id,
      `Tax remittance submitted: ${run.period.registration.jurisdictionReference.authorityName}`,
      `${run.period.periodId} was marked submitted${parsed.confirmationRef ? ` with confirmation ${parsed.confirmationRef}` : ""}.`,
    );
  }

  if (parsed.status === "paid") {
    await prisma.taxObligationPeriod.update({
      where: { id: run.periodId },
      data: {
        status: "paid",
        paidAt: now,
        confirmationRef: nullableString(parsed.confirmationRef),
      },
    });
    await resolveOperationalTaxIssue("tax_execution_failed", run.period.registrationId, run.periodId);
    await createTaxNotification(
      user.id,
      `Tax remittance paid: ${run.period.registration.jurisdictionReference.authorityName}`,
      `${run.period.periodId} was marked paid${parsed.confirmationRef ? ` with confirmation ${parsed.confirmationRef}` : ""}.`,
    );
  }

  if (parsed.status === "failed" || parsed.status === "blocked") {
    await upsertOperationalTaxIssue({
      profileId: run.period.registration.organizationTaxProfileId,
      issueType: "tax_execution_failed",
      registrationId: run.period.registrationId,
      periodId: run.periodId,
      title: `${run.period.registration.jurisdictionReference.authorityName} execution failed`,
      details:
        nullableString(parsed.failureDetails) ??
        "The remittance run failed and needs employee follow-up before filing can continue.",
      severity: "high",
    });
    await createTaxNotification(
      user.id,
      `Tax remittance failed: ${run.period.registration.jurisdictionReference.authorityName}`,
      `${run.period.periodId} failed${parsed.failureDetails ? `: ${parsed.failureDetails}` : "."}`,
    );
  }

  revalidateTaxRoutes();
  return updated;
}

export async function addTaxFilingArtifact(input: AddTaxFilingArtifactInput) {
  const user = await requireManageFinance();
  const parsed = addTaxFilingArtifactSchema.parse(input);

  const period = await prisma.taxObligationPeriod.findFirst({
    where: { id: parsed.periodId },
  });

  if (!period) {
    throw new Error("Tax obligation period not found.");
  }

  const artifact = await prisma.taxFilingArtifact.create({
    data: {
      periodId: period.id,
      artifactType: parsed.artifactType,
      storageKey: nullableString(parsed.storageKey),
      externalRef: nullableString(parsed.externalRef),
      sourceUrl: nullableString(parsed.sourceUrl),
      notes: nullableString(parsed.notes),
      createdByUserId: user.id,
    },
  });

  revalidateTaxRoutes();
  return artifact;
}
