import { newId } from "@/lib/shared/new-id";
import { prisma, type Prisma } from "@dpf/db";
import {
  recordAiProviderSubscriptionPaymentSchema,
  type ActivateAiProviderContractInput,
  type CreateContractUsageSnapshotInput,
  type CreateFinanceWorkItemInput,
  type RecordAiProviderSubscriptionPaymentInput,
  type SeedAiProviderFinanceBridgeInput,
} from "./ai-provider-finance-validation";

function decimal(value: number | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  return value;
}

function toJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  if (!value) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function firstDayOfMonth(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), 1));
}

function lastDayOfMonth(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth() + 1, 0));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const aiContractInclude = {
  allowances: {
    orderBy: { sortOrder: "asc" },
  },
  usageSnapshots: {
    orderBy: { snapshotDate: "desc" },
    take: 1,
  },
  bills: {
    orderBy: { issueDate: "desc" },
    take: 6,
    include: {
      allocations: {
        include: {
          payment: {
            select: {
              id: true,
              paymentRef: true,
              amount: true,
              currency: true,
              method: true,
              status: true,
              receivedAt: true,
              reference: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.SupplierContractInclude;

type AiContractWithTraceability = Prisma.SupplierContractGetPayload<{
  include: typeof aiContractInclude;
}>;

type AiProfileWithFinanceRows = Prisma.AiProviderFinanceProfileGetPayload<{
  include: {
    provider: { select: { providerId: true; name: true; status: true } };
    supplier: { select: { id: true; supplierId: true; name: true } };
    supplierContracts: { include: typeof aiContractInclude };
    financeWorkItems: true;
  };
}>;

type AiProviderFinanceDetailBase = Prisma.AiProviderFinanceProfileGetPayload<{
  include: {
    supplier: true;
    supplierContracts: { include: typeof aiContractInclude };
    financeWorkItems: true;
  };
}>;

type AiSupplierFinanceDetailBase = Prisma.SupplierGetPayload<{
  include: {
    aiProviderProfiles: {
      include: {
        provider: true;
        supplierContracts: { include: typeof aiContractInclude };
        financeWorkItems: true;
      };
    };
    supplierContracts: { include: typeof aiContractInclude };
  };
}>;

type FinanceCommitmentKind = "ai_provider" | "domain" | "saas_subscription" | "one_time";

type EnsureFinanceCommitmentInput = {
  commitmentKind: FinanceCommitmentKind;
  externalReference: string;
  title: string;
  supplierName: string;
  commitmentSource?: string;
  contractType?: string;
  billingCadence?: string;
  currency?: string;
  monthlyCommittedAmount?: number;
  budgetAmount?: number;
  renewalDate?: string | Date;
  startDate?: string | Date;
  endDate?: string | Date;
  billingUrl?: string;
  usageUrl?: string;
  accountableEmployeeId?: string;
  profileId?: string | null;
  missingFields?: string[];
  routeTarget?: string;
};

function dateOrNull(value: string | Date | undefined): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function humanizeWorkItemType(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

type ExistingAiProviderContractPlan = {
  id?: string;
  coveredProviderIds?: Prisma.JsonValue | null;
  monthlyCommittedAmount?: number | Prisma.Decimal | null;
  usageUnit?: string | null;
  allowances?: Array<{
    includedQuantity?: number | Prisma.Decimal | null;
    usageUnit?: string | null;
  }>;
};

type ContractWithCoverage = ExistingAiProviderContractPlan & {
  id: string;
  contractId?: string;
  coveredProviderIds?: Prisma.JsonValue | null;
};

function hasKnownNumber(value: number | Prisma.Decimal | null | undefined): boolean {
  return value !== undefined && value !== null;
}

function normalizeProviderIds(providerIds: string[]): string[] {
  return [...new Set(providerIds.map((id) => id.trim()).filter(Boolean))].sort();
}

function providerIdsFromCoverage(value: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function contractCoversProvider(contract: ContractWithCoverage, providerId: string): boolean {
  return providerIdsFromCoverage(contract.coveredProviderIds).includes(providerId);
}

function mergeAiContracts(
  directContracts: AiContractWithTraceability[],
  sharedContracts: AiContractWithTraceability[],
): AiContractWithTraceability[] {
  const contractMap = new Map(directContracts.map((contract) => [contract.id, contract]));
  for (const contract of sharedContracts) {
    contractMap.set(contract.id, contract);
  }
  return [...contractMap.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function nextBillingDateFromPaidAt(paidAt: Date, billingDayOfMonth: number): Date {
  const nextMonth = paidAt.getUTCDate() >= billingDayOfMonth
    ? paidAt.getUTCMonth() + 1
    : paidAt.getUTCMonth();
  const daysInTargetMonth = new Date(Date.UTC(paidAt.getUTCFullYear(), nextMonth + 1, 0)).getUTCDate();
  const day = Math.min(billingDayOfMonth, daysInTargetMonth);
  return new Date(Date.UTC(paidAt.getUTCFullYear(), nextMonth, day));
}

async function generatePaymentRef(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.payment.count();
  const seq = String(count + 1).padStart(4, "0");
  return `PAY-${year}-${seq}`;
}

function getMissingAiProviderPlanFields(
  input: SeedAiProviderFinanceBridgeInput,
  existingContract?: ExistingAiProviderContractPlan | null,
): string[] {
  const existingAllowance = existingContract?.allowances?.find(
    (allowance) => hasKnownNumber(allowance.includedQuantity) || Boolean(allowance.usageUnit),
  );

  return [
    input.monthlyCommittedAmount === undefined && !hasKnownNumber(existingContract?.monthlyCommittedAmount)
      ? "monthlyCommittedAmount"
      : null,
    input.includedQuantity === undefined && !hasKnownNumber(existingAllowance?.includedQuantity)
      ? "includedQuantity"
      : null,
    !input.usageUnit && !existingContract?.usageUnit && !existingAllowance?.usageUnit ? "usageUnit" : null,
  ].filter((field): field is string => Boolean(field));
}

async function ensureSupplier(input: SeedAiProviderFinanceBridgeInput) {
  const supplierName = input.supplierName ?? input.providerName;
  const existing = await prisma.supplier.findFirst({
    where: { name: supplierName },
    select: { id: true, supplierId: true },
  });

  if (existing) return existing;

  return prisma.supplier.create({
    data: {
      supplierId: `SUP-${newId(8)}`,
      name: supplierName,
      paymentTerms: "Net 30",
      defaultCurrency: input.currency ?? "USD",
      notes: `AI provider supplier bridge for ${input.providerId}.`,
      status: "active",
    },
    select: { id: true, supplierId: true },
  });
}

async function createFinanceWorkItem(input: CreateFinanceWorkItemInput) {
  return prisma.financeWorkItem.create({
    data: {
      workItemId: `FWI-${newId(8)}`,
      profileId: input.profileId ?? null,
      contractId: input.contractId ?? null,
      supplierId: input.supplierId ?? null,
      ownerEmployeeId: input.ownerEmployeeId ?? null,
      type: input.type,
      status: input.status ?? "open",
      severity: input.severity ?? "medium",
      title: input.title,
      description: input.description ?? null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      metadata: toJson(input.metadata),
    },
    select: { id: true, workItemId: true },
  });
}

async function ensureFinanceWorkItem(input: CreateFinanceWorkItemInput) {
  const existing = await prisma.financeWorkItem.findFirst({
    where: {
      profileId: input.profileId ?? undefined,
      contractId: input.contractId ?? undefined,
      supplierId: input.supplierId ?? undefined,
      type: input.type,
      status: { in: ["open", "in_progress"] },
    },
    select: { id: true, workItemId: true },
  });

  if (existing) return existing;
  return createFinanceWorkItem(input);
}

export async function seedAiProviderFinanceBridge(input: SeedAiProviderFinanceBridgeInput) {
  const supplier = await ensureSupplier(input);

  const profile = await prisma.aiProviderFinanceProfile.upsert({
    where: { providerId: input.providerId },
    create: {
      providerId: input.providerId,
      supplierId: supplier.id,
      status: "seeded",
      reconciliationStrategy: input.reconciliationStrategy,
      valuationMethod: input.valuationMethod,
      planCurrency: input.currency ?? "USD",
      billingUrl: input.billingUrl ?? null,
      usageUrl: input.usageUrl ?? null,
      monthlyBudget: decimal(input.budgetAmount),
    },
    update: {
      supplierId: supplier.id,
      reconciliationStrategy: input.reconciliationStrategy,
      valuationMethod: input.valuationMethod,
      planCurrency: input.currency ?? "USD",
      billingUrl: input.billingUrl ?? null,
      usageUrl: input.usageUrl ?? null,
      monthlyBudget: decimal(input.budgetAmount),
    },
    select: { id: true, supplierId: true },
  });

  const existingContract = await prisma.supplierContract.findFirst({
    where: { profileId: profile.id, status: { in: ["draft", "active"] } },
    select: {
      id: true,
      contractId: true,
      coveredProviderIds: true,
      monthlyCommittedAmount: true,
      usageUnit: true,
      allowances: {
        orderBy: { sortOrder: "asc" },
        take: 1,
        select: {
          includedQuantity: true,
          usageUnit: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const sharedContract = existingContract
    ? null
    : (await prisma.supplierContract.findMany({
        where: {
          supplierId: supplier.id,
          status: { in: ["draft", "active"] },
          commitmentKind: { in: ["ai_provider", "saas_subscription"] },
        },
        select: {
          id: true,
          contractId: true,
          coveredProviderIds: true,
          monthlyCommittedAmount: true,
          usageUnit: true,
          allowances: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: {
              includedQuantity: true,
              usageUnit: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      })).find((contract) => contractCoversProvider(contract, input.providerId)) ?? null;

  const contract = existingContract ?? sharedContract ?? (await prisma.supplierContract.create({
    data: {
      contractId: `AIC-${newId(8)}`,
      profileId: profile.id,
      supplierId: supplier.id,
      accountableEmployeeId: input.accountableEmployeeId ?? null,
      commitmentKind: "ai_provider",
      commitmentSource: "ai_provider_registry",
      externalReference: `ai-provider:${input.providerId}`,
      status: "draft",
      contractType: "subscription",
      billingCadence: "monthly",
      coveredProviderIds: [input.providerId],
      currency: input.currency ?? "USD",
      monthlyCommittedAmount: decimal(input.monthlyCommittedAmount),
      budgetAmount: decimal(input.budgetAmount),
      budgetWindow: "monthly",
      usageUnit: input.usageUnit ?? null,
      billingUrl: input.billingUrl ?? null,
      usageUrl: input.usageUrl ?? null,
      allowsOverage: false,
    },
    select: {
      id: true,
      contractId: true,
      coveredProviderIds: true,
      monthlyCommittedAmount: true,
      usageUnit: true,
      allowances: {
        orderBy: { sortOrder: "asc" },
        take: 1,
        select: {
          includedQuantity: true,
          usageUnit: true,
        },
      },
    },
  }));

  const missingFields = getMissingAiProviderPlanFields(input, contract);
  const missingPlanDetails = missingFields.length > 0;

  const workItem = missingPlanDetails
    ? await ensureFinanceWorkItem({
        profileId: profile.id,
        contractId: contract.id,
        supplierId: supplier.id,
        ownerEmployeeId: input.accountableEmployeeId,
        type: "plan_details_needed",
        status: "open",
        title: `Complete AI plan details for ${input.providerName}`,
        description: "Capture commitment, included allowance, and billing source details for finance ownership.",
        severity: "medium",
        metadata: {
          askKind: "human_finance_gap",
          source: "ai_provider_finance_reconciliation",
          providerId: input.providerId,
          providerName: input.providerName,
          missingFields,
          routeTarget: "/finance/spend/ai",
          suggestedQuestion: `What plan, monthly cost, included allowance, and billing source should Finance track for ${input.providerName}?`,
        },
      })
    : null;

  return {
    supplierId: supplier.id,
    profileId: profile.id,
    contractId: contract.id,
    workItemId: workItem?.id ?? null,
  };
}

export async function ensureFinanceCommitment(input: EnsureFinanceCommitmentInput) {
  const supplier = await prisma.supplier.findFirst({
    where: { name: input.supplierName },
    select: { id: true, supplierId: true },
  }) ?? await prisma.supplier.create({
    data: {
      supplierId: `SUP-${newId(8)}`,
      name: input.supplierName,
      paymentTerms: "Net 30",
      defaultCurrency: input.currency ?? "USD",
      notes: `Finance commitment supplier for ${input.title}.`,
      status: "active",
    },
    select: { id: true, supplierId: true },
  });

  const missingFields = input.missingFields ?? [
    input.monthlyCommittedAmount === undefined ? "monthlyCommittedAmount" : null,
    input.renewalDate === undefined && input.contractType !== "one_time" ? "renewalDate" : null,
  ].filter((field): field is string => Boolean(field));

  const contract = await prisma.supplierContract.upsert({
    where: { externalReference: input.externalReference },
    create: {
      contractId: `FNC-${newId(8)}`,
      profileId: input.profileId ?? null,
      supplierId: supplier.id,
      accountableEmployeeId: input.accountableEmployeeId ?? null,
      commitmentKind: input.commitmentKind,
      commitmentSource: input.commitmentSource ?? "manual_finance_intake",
      externalReference: input.externalReference,
      status: "draft",
      contractType: input.contractType ?? "subscription",
      billingCadence: input.billingCadence ?? "monthly",
      currency: input.currency ?? "USD",
      monthlyCommittedAmount: decimal(input.monthlyCommittedAmount),
      budgetAmount: decimal(input.budgetAmount),
      budgetWindow: input.billingCadence ?? "monthly",
      billingUrl: input.billingUrl ?? null,
      usageUrl: input.usageUrl ?? null,
      renewalDate: dateOrNull(input.renewalDate),
      startDate: dateOrNull(input.startDate),
      endDate: dateOrNull(input.endDate),
      allowsOverage: false,
      notes: input.title,
    },
    update: {
      profileId: input.profileId ?? undefined,
      supplierId: supplier.id,
      accountableEmployeeId: input.accountableEmployeeId ?? null,
      commitmentKind: input.commitmentKind,
      commitmentSource: input.commitmentSource ?? "manual_finance_intake",
      contractType: input.contractType ?? "subscription",
      billingCadence: input.billingCadence ?? "monthly",
      currency: input.currency ?? "USD",
      monthlyCommittedAmount: decimal(input.monthlyCommittedAmount),
      budgetAmount: decimal(input.budgetAmount),
      budgetWindow: input.billingCadence ?? "monthly",
      billingUrl: input.billingUrl ?? null,
      usageUrl: input.usageUrl ?? null,
      renewalDate: dateOrNull(input.renewalDate),
      startDate: dateOrNull(input.startDate),
      endDate: dateOrNull(input.endDate),
      notes: input.title,
    },
    select: { id: true, contractId: true },
  });

  const workItem = missingFields.length > 0
    ? await ensureFinanceWorkItem({
        contractId: contract.id,
        supplierId: supplier.id,
        ownerEmployeeId: input.accountableEmployeeId,
        type: "commitment_details_needed",
        status: "open",
        severity: "medium",
        title: `Complete financial details for ${input.title}`,
        description: `Capture ${missingFields.map(humanizeWorkItemType).join(", ")} so Finance can account for this commitment.`,
        metadata: {
          askKind: "human_finance_gap",
          source: input.commitmentSource ?? "manual_finance_intake",
          commitmentKind: input.commitmentKind,
          externalReference: input.externalReference,
          missingFields,
          routeTarget: input.routeTarget ?? "/finance/spend",
          suggestedQuestion: `What cost, renewal, billing owner, and payment evidence should Finance track for ${input.title}?`,
        },
      })
    : null;

  return {
    supplierId: supplier.id,
    contractId: contract.id,
    workItemId: workItem?.id ?? null,
  };
}

export async function recordAiProviderSubscriptionPayment(input: RecordAiProviderSubscriptionPaymentInput) {
  const parsed = recordAiProviderSubscriptionPaymentSchema.parse(input);
  const providerIds = normalizeProviderIds(parsed.providerIds);
  if (providerIds.length === 0) throw new Error("At least one provider is required");

  const providers = await prisma.modelProvider.findMany({
    where: { providerId: { in: providerIds } },
    select: {
      providerId: true,
      name: true,
      consoleUrl: true,
      docsUrl: true,
    },
  });
  const foundProviderIds = new Set(providers.map((provider) => provider.providerId));
  const missingProviderIds = providerIds.filter((providerId) => !foundProviderIds.has(providerId));
  if (missingProviderIds.length > 0) {
    throw new Error(`Unknown AI provider: ${missingProviderIds.join(", ")}`);
  }

  const paidAt = new Date(parsed.paidAt);
  if (Number.isNaN(paidAt.getTime())) {
    throw new Error("Paid date is invalid");
  }
  const nextBillingDate = nextBillingDateFromPaidAt(paidAt, parsed.billingDayOfMonth);
  const planName = parsed.planName?.trim() || `${parsed.supplierName} AI subscription`;
  const supplier = await prisma.supplier.findFirst({
    where: { name: parsed.supplierName },
    select: { id: true, supplierId: true },
  }) ?? await prisma.supplier.create({
    data: {
      supplierId: `SUP-${newId(8)}`,
      name: parsed.supplierName,
      paymentTerms: "Card on file",
      defaultCurrency: parsed.currency ?? "USD",
      notes: `AI subscription supplier for ${planName}.`,
      status: "active",
    },
    select: { id: true, supplierId: true },
  });

  const profiles = [];
  for (const provider of providers) {
    profiles.push(await prisma.aiProviderFinanceProfile.upsert({
      where: { providerId: provider.providerId },
      create: {
        providerId: provider.providerId,
        supplierId: supplier.id,
        status: "active",
        reconciliationStrategy: "provider_portal",
        valuationMethod: "commitment_first",
        planCurrency: parsed.currency ?? "USD",
        billingUrl: parsed.billingUrl ?? provider.consoleUrl ?? null,
        usageUrl: provider.consoleUrl ?? provider.docsUrl ?? null,
        monthlyBudget: decimal(parsed.amount),
      },
      update: {
        supplierId: supplier.id,
        status: "active",
        reconciliationStrategy: "provider_portal",
        valuationMethod: "commitment_first",
        planCurrency: parsed.currency ?? "USD",
        billingUrl: parsed.billingUrl ?? provider.consoleUrl ?? null,
        usageUrl: provider.consoleUrl ?? provider.docsUrl ?? null,
        monthlyBudget: decimal(parsed.amount),
      },
      select: { id: true, supplierId: true, providerId: true },
    }));
  }

  const primaryProfile = profiles.find((profile) => profile.providerId === providerIds[0]) ?? profiles[0]!;
  const externalReference = `ai-subscription:${supplier.id}:${providerIds.join("+")}`;
  const coveredProviderIds = providerIds;

  const contract = await prisma.supplierContract.upsert({
    where: { externalReference },
    create: {
      contractId: `AIS-${newId(8)}`,
      profileId: primaryProfile.id,
      supplierId: supplier.id,
      commitmentKind: "ai_provider",
      commitmentSource: "owner_entered_subscription_payment",
      externalReference,
      status: "active",
      contractType: "subscription",
      billingCadence: parsed.billingCadence ?? "monthly",
      billingDayOfMonth: parsed.billingDayOfMonth,
      currency: parsed.currency ?? "USD",
      monthlyCommittedAmount: decimal(parsed.amount),
      budgetAmount: decimal(parsed.amount),
      budgetWindow: parsed.billingCadence ?? "monthly",
      usageUnit: "subscription_access",
      paymentMethod: parsed.paymentMethod ?? "card",
      paymentReference: parsed.paymentReference ?? null,
      coveredProviderIds,
      billingUrl: parsed.billingUrl ?? null,
      renewalDate: nextBillingDate,
      startDate: paidAt,
      allowsOverage: false,
      notes: planName,
    },
    update: {
      profileId: primaryProfile.id,
      supplierId: supplier.id,
      commitmentKind: "ai_provider",
      commitmentSource: "owner_entered_subscription_payment",
      status: "active",
      contractType: "subscription",
      billingCadence: parsed.billingCadence ?? "monthly",
      billingDayOfMonth: parsed.billingDayOfMonth,
      currency: parsed.currency ?? "USD",
      monthlyCommittedAmount: decimal(parsed.amount),
      budgetAmount: decimal(parsed.amount),
      budgetWindow: parsed.billingCadence ?? "monthly",
      usageUnit: "subscription_access",
      paymentMethod: parsed.paymentMethod ?? "card",
      paymentReference: parsed.paymentReference ?? null,
      coveredProviderIds,
      billingUrl: parsed.billingUrl ?? null,
      renewalDate: nextBillingDate,
      startDate: paidAt,
      allowsOverage: false,
      notes: planName,
    },
    select: { id: true, contractId: true },
  });

  const billInvoiceRef = `${contract.contractId}-${monthKey(paidAt)}`;
  const existingBill = await prisma.bill.findFirst({
    where: {
      supplierId: supplier.id,
      supplierContractId: contract.id,
      invoiceRef: billInvoiceRef,
    },
    select: {
      id: true,
      billRef: true,
      allocations: {
        take: 1,
        include: {
          payment: {
            select: {
              id: true,
              paymentRef: true,
            },
          },
        },
      },
    },
  });

  const bill = existingBill ?? await prisma.bill.create({
    data: {
      billRef: `BILL-${new Date().getUTCFullYear()}-${newId(6).toUpperCase()}`,
      supplierId: supplier.id,
      supplierContractId: contract.id,
      status: "paid",
      invoiceRef: billInvoiceRef,
      issueDate: paidAt,
      dueDate: paidAt,
      currency: parsed.currency ?? "USD",
      subtotal: parsed.amount,
      taxAmount: 0,
      totalAmount: parsed.amount,
      amountPaid: parsed.amount,
      amountDue: 0,
      notes: [
        parsed.notes,
        parsed.evidenceUrl ? `Evidence: ${parsed.evidenceUrl}` : null,
        `Covers: ${providers.map((provider) => provider.name).join(", ")}`,
      ].filter(Boolean).join("\n") || null,
      lineItems: {
        create: [
          {
            description: planName,
            quantity: 1,
            unitPrice: parsed.amount,
            taxRate: 0,
            taxAmount: 0,
            lineTotal: parsed.amount,
            accountCode: null,
            sortOrder: 0,
          },
        ],
      },
    },
    select: { id: true, billRef: true, allocations: true },
  });

  const existingPayment = existingBill?.allocations[0]?.payment ?? null;
  const payment = existingPayment ?? await prisma.payment.create({
    data: {
      paymentRef: await generatePaymentRef(),
      direction: "outbound",
      method: parsed.paymentMethod ?? "card",
      status: "completed",
      amount: parsed.amount,
      currency: parsed.currency ?? "USD",
      reference: parsed.paymentReference ?? null,
      counterpartyId: supplier.id,
      counterpartyType: "supplier",
      receivedAt: paidAt,
      processedAt: paidAt,
      notes: parsed.evidenceUrl ? `Evidence: ${parsed.evidenceUrl}` : parsed.notes ?? null,
    },
    select: { id: true, paymentRef: true },
  });

  if (!existingPayment) {
    await prisma.paymentAllocation.create({
      data: {
        paymentId: payment.id,
        billId: bill.id,
        amount: parsed.amount,
      },
    });
  }

  await prisma.financeWorkItem.updateMany({
    where: {
      status: { in: ["open", "in_progress"] },
      type: { in: ["plan_details_needed", "commitment_details_needed", "browser_profile_needed"] },
      OR: [
        { contractId: contract.id },
        { profileId: { in: profiles.map((profile) => profile.id) } },
        { supplierId: supplier.id },
      ],
    },
    data: {
      status: "done",
      resolvedAt: new Date(),
    },
  });

  return {
    supplierId: supplier.id,
    contractId: contract.id,
    billId: bill.id,
    paymentId: payment.id,
    coveredProviderIds,
  };
}

export async function reconcileAiProviderFinanceGaps() {
  const providers = await prisma.modelProvider.findMany({
    where: {
      status: "active",
      OR: [
        { cliEngine: { not: null } },
        { costModel: "subscription" },
        { costBand: { not: "free" } },
        { inputPricePerMToken: { not: null } },
        { outputPricePerMToken: { not: null } },
      ],
    },
    select: {
      providerId: true,
      name: true,
      cliEngine: true,
      costModel: true,
      billingLabel: true,
      consoleUrl: true,
      docsUrl: true,
      inputPricePerMToken: true,
      outputPricePerMToken: true,
      financeProfile: { select: { id: true } },
    },
    orderBy: { providerId: "asc" },
  });

  let seededProfiles = 0;
  let queuedHumanAsks = 0;

  for (const provider of providers) {
    const result = await seedAiProviderFinanceBridge({
      providerId: provider.providerId,
      providerName: provider.name,
      billingUrl: provider.consoleUrl ?? undefined,
      usageUrl: provider.consoleUrl ?? provider.docsUrl ?? undefined,
      reconciliationStrategy: provider.costModel === "subscription" || provider.cliEngine
        ? "provider_portal"
        : "internal_observed",
      valuationMethod: provider.costModel === "subscription" || provider.cliEngine
        ? "commitment_first"
        : "metered",
    });

    if (!provider.financeProfile) seededProfiles++;
    if (result.workItemId) queuedHumanAsks++;
  }

  return {
    inspectedProviders: providers.length,
    seededProfiles,
    queuedHumanAsks,
  };
}

export async function activateAiProviderContract(input: ActivateAiProviderContractInput) {
  const contract = await prisma.supplierContract.update({
    where: { id: input.contractId },
    data: {
      status: "active",
      accountableEmployeeId: input.accountableEmployeeId,
      currency: input.currency,
      monthlyCommittedAmount: decimal(input.monthlyCommittedAmount),
      billingCadence: input.billingCadence,
      budgetAmount: decimal(input.budgetAmount),
      allowsOverage: input.allowsOverage ?? false,
      billingUrl: input.billingUrl ?? null,
      usageUrl: input.usageUrl ?? null,
    },
    select: { id: true, status: true },
  });

  await prisma.contractAllowance.deleteMany({
    where: { contractId: input.contractId },
  });

  await prisma.contractAllowance.createMany({
    data: input.allowances.map((allowance, index) => ({
      contractId: input.contractId,
      allowanceName: allowance.allowanceName,
      usageUnit: allowance.usageUnit,
      includedQuantity: decimal(allowance.includedQuantity)!,
      overageUnitCost: decimal(allowance.overageUnitCost),
      valuationMethod: allowance.valuationMethod,
      sortOrder: index,
    })),
  });

  await prisma.financeWorkItem.updateMany({
    where: {
      contractId: input.contractId,
      type: "plan_details_needed",
      status: { in: ["open", "in_progress"] },
    },
    data: {
      status: "done",
      resolvedAt: new Date(),
    },
  });

  return contract;
}

export function evaluateAiProviderUtilization(input: {
  includedQuantity: number;
  consumedQuantity: number;
  monthlyCommittedAmount: number;
  dayOfMonth: number;
  daysInMonth: number;
}) {
  const utilizationPct = input.includedQuantity > 0
    ? round2((input.consumedQuantity / input.includedQuantity) * 100)
    : 0;
  const projectedMonthEndQuantity = input.dayOfMonth > 0
    ? round2((input.consumedQuantity / input.dayOfMonth) * input.daysInMonth)
    : input.consumedQuantity;
  const remainingQuantity = round2(input.includedQuantity - input.consumedQuantity);
  const unusedQuantity = Math.max(input.includedQuantity - projectedMonthEndQuantity, 0);
  const projectedUnusedValue = input.includedQuantity > 0
    ? round2((unusedQuantity / input.includedQuantity) * input.monthlyCommittedAmount)
    : 0;
  const projectedOverageCost = projectedMonthEndQuantity > input.includedQuantity
    ? round2(projectedMonthEndQuantity - input.includedQuantity)
    : 0;

  const flags: string[] = [];
  if (remainingQuantity / input.includedQuantity <= 0.1) flags.push("critical_low_allowance");
  if (projectedUnusedValue > 0) flags.push("underused_commitment");
  if (projectedMonthEndQuantity > input.includedQuantity) flags.push("overage_risk");

  return {
    utilizationPct,
    projectedMonthEndQuantity,
    remainingQuantity,
    projectedUnusedValue,
    projectedOverageCost,
    flags,
  };
}

export async function createContractUsageSnapshot(input: CreateContractUsageSnapshotInput) {
  return prisma.contractUsageSnapshot.create({
    data: {
      contractId: input.contractId,
      snapshotDate: new Date(input.snapshotDate),
      sourceType: input.sourceType,
      confidence: input.confidence ?? "medium",
      consumedQuantity: decimal(input.consumedQuantity)!,
      includedQuantity: decimal(input.includedQuantity),
      remainingQuantity: decimal(input.remainingQuantity),
      utilizationPct: input.utilizationPct ?? null,
      projectedMonthEndQuantity: decimal(input.projectedMonthEndQuantity),
      projectedUnusedValue: decimal(input.projectedUnusedValue),
      projectedOverageCost: decimal(input.projectedOverageCost),
      metadata: toJson(input.metadata),
    },
  });
}

export async function getAiSpendOverview() {
  // Current month window for actual spend aggregation
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [profiles, activeProviderCount, untrackedProviderCount, contracts, workItems, snapshots, actualSpendAgg] = await Promise.all([
    prisma.aiProviderFinanceProfile.count(),
    prisma.modelProvider.count({
      where: { status: "active" },
    }),
    prisma.modelProvider.count({
      where: {
        status: "active",
        financeProfile: { is: null },
      },
    }),
    prisma.supplierContract.findMany({
      where: { status: { in: ["draft", "active"] } },
      select: {
        id: true,
        status: true,
        monthlyCommittedAmount: true,
      },
    }),
    prisma.financeWorkItem.count({
      where: { status: { in: ["open", "in_progress"] } },
    }),
    prisma.contractUsageSnapshot.findMany({
      orderBy: { snapshotDate: "desc" },
      take: 20,
      select: { projectedUnusedValue: true },
    }),
    // EP-COST: Aggregate actual token spend from AdapterRunTelemetry for the current month.
    // estimatedCostUsd is populated by computeTokenCost() using per-model pricing from ModelProfile.
    // Subscription providers (anthropic-sub, chatgpt) show $0 here — their fixed monthly cost
    // is captured in the SupplierContract.monthlyCommittedAmount below.
    prisma.adapterRunTelemetry.aggregate({
      where: {
        startedAt: { gte: monthStart },
        estimatedCostUsd: { not: null },
      },
      _sum: { estimatedCostUsd: true },
      _count: { id: true },
    }),
  ]);

  const committedSpend = contracts.reduce((sum, contract) => sum + Number(contract.monthlyCommittedAmount ?? 0), 0);
  const contractsNeedingSetup = contracts.filter((contract) => contract.status === "draft").length;
  const projectedUnusedCommitment = snapshots.reduce((sum, snapshot) => sum + Number(snapshot.projectedUnusedValue ?? 0), 0);

  // Actual metered API spend this month (excludes subscription providers at $0/call)
  const actualMeteredSpendUsd = Number(actualSpendAgg._sum.estimatedCostUsd ?? 0);
  const inferenceCallsThisMonth = actualSpendAgg._count.id ?? 0;

  return {
    supplierCount: profiles,
    activeProviderCount,
    untrackedProviderCount,
    committedSpend,
    contractsNeedingSetup,
    openWorkItems: workItems,
    dataQualityIssueCount: untrackedProviderCount + contractsNeedingSetup + workItems,
    projectedUnusedCommitment,
    // EP-COST additions: actual spend from inference telemetry
    actualMeteredSpendUsd,
    inferenceCallsThisMonth,
    monthStart,
  };
}

export async function listAiProviderFinanceProfiles() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // EP-COST: per-provider actual metered spend this month from AdapterRunTelemetry
  const spendByProvider = await prisma.adapterRunTelemetry.groupBy({
    by: ["providerId"],
    where: {
      startedAt: { gte: monthStart },
      estimatedCostUsd: { not: null },
    },
    _sum: { estimatedCostUsd: true },
    _count: { id: true },
  });
  const spendMap = new Map(
    spendByProvider.map((r) => [
      r.providerId,
      { costUsd: Number(r._sum.estimatedCostUsd ?? 0), calls: r._count.id },
    ]),
  );

  const [profiles, sharedContracts] = await Promise.all([
    prisma.aiProviderFinanceProfile.findMany({
      include: {
        provider: {
          select: {
            providerId: true,
            name: true,
            status: true,
          },
        },
        supplier: {
          select: {
            id: true,
            supplierId: true,
            name: true,
          },
        },
        supplierContracts: {
          include: aiContractInclude,
          orderBy: { createdAt: "desc" },
        },
        financeWorkItems: {
          where: { status: { in: ["open", "in_progress"] } },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.supplierContract.findMany({
      where: {
        status: { in: ["draft", "active"] },
        commitmentKind: { in: ["ai_provider", "saas_subscription"] },
      },
      include: aiContractInclude,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const sharedContractsByProvider = new Map<string, AiContractWithTraceability[]>();
  for (const contract of sharedContracts) {
    for (const providerId of providerIdsFromCoverage(contract.coveredProviderIds)) {
      const contracts = sharedContractsByProvider.get(providerId) ?? [];
      contracts.push(contract);
      sharedContractsByProvider.set(providerId, contracts);
    }
  }

  // Attach actual spend data to each profile row
  return profiles.map((p) => {
    return {
      ...p,
      supplierContracts: mergeAiContracts(
        p.supplierContracts,
        sharedContractsByProvider.get(p.providerId) ?? [],
      ),
      actualSpendMtd: spendMap.get(p.providerId) ?? { costUsd: 0, calls: 0 },
    };
  }) satisfies Array<AiProfileWithFinanceRows & { actualSpendMtd: { costUsd: number; calls: number } }>;
}

export async function getAiProviderFinanceDetail(providerId: string) {
  const [detail, sharedContracts] = await Promise.all([
    prisma.aiProviderFinanceProfile.findUnique({
      where: { providerId },
      include: {
        supplier: true,
        supplierContracts: {
          include: aiContractInclude,
          orderBy: { createdAt: "desc" },
        },
        financeWorkItems: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    }),
    prisma.supplierContract.findMany({
      where: {
        status: { in: ["draft", "active"] },
        commitmentKind: { in: ["ai_provider", "saas_subscription"] },
      },
      include: aiContractInclude,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!detail) return null;

  return {
    ...detail,
    supplierContracts: mergeAiContracts(
      detail.supplierContracts,
      sharedContracts.filter((contract) => contractCoversProvider(contract, providerId)),
    ),
  } satisfies AiProviderFinanceDetailBase;
}

export async function getAiSupplierFinanceDetail(supplierId: string) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    include: {
      aiProviderProfiles: {
        include: {
          provider: true,
          supplierContracts: {
            include: aiContractInclude,
            orderBy: { createdAt: "desc" },
          },
          financeWorkItems: {
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
        orderBy: { createdAt: "desc" },
      },
      supplierContracts: {
        include: aiContractInclude,
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!supplier) return null;

  return {
    ...supplier,
    aiProviderProfiles: supplier.aiProviderProfiles.map((profile) => {
      const sharedContracts = supplier.supplierContracts.filter((contract) =>
        contractCoversProvider(contract, profile.providerId),
      );
      return {
        ...profile,
        supplierContracts: mergeAiContracts(profile.supplierContracts, sharedContracts),
      };
    }),
  } satisfies AiSupplierFinanceDetailBase;
}

function billingDateForCycle(cycleDate: Date, billingDayOfMonth?: number | null): Date {
  if (!billingDayOfMonth) return cycleDate;
  const daysInMonth = new Date(Date.UTC(cycleDate.getUTCFullYear(), cycleDate.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(billingDayOfMonth, 1), daysInMonth);
  return new Date(Date.UTC(cycleDate.getUTCFullYear(), cycleDate.getUTCMonth(), day));
}

export async function maybeRunAiProviderFinanceDailyEvaluation(now = new Date()) {
  await reconcileAiProviderFinanceGaps();

  const contracts = await prisma.supplierContract.findMany({
    where: { status: "active" },
    include: {
      allowances: {
        orderBy: { sortOrder: "asc" },
        take: 1,
      },
      profile: {
        select: {
          providerId: true,
          planCurrency: true,
        },
      },
      usageSnapshots: {
        where: {
          snapshotDate: {
            gte: firstDayOfMonth(now),
            lte: lastDayOfMonth(now),
          },
        },
        orderBy: { snapshotDate: "desc" },
      },
    },
  });

  return Promise.all(contracts.map(async (contract) => {
    const allowance = contract.allowances[0];
    if (!allowance) {
      return ensureFinanceWorkItem({
        contractId: contract.id,
        supplierId: contract.supplierId,
        ownerEmployeeId: contract.accountableEmployeeId ?? undefined,
        type: "missing_usage_source",
        status: "open",
        severity: "high",
        title: `Add allowance details for ${contract.contractId}`,
      });
    }

    const consumedQuantity = contract.usageSnapshots.reduce(
      (sum, snapshot) => sum + Number(snapshot.consumedQuantity),
      0,
    );
    const utilization = evaluateAiProviderUtilization({
      includedQuantity: Number(allowance.includedQuantity),
      consumedQuantity,
      monthlyCommittedAmount: Number(contract.monthlyCommittedAmount ?? 0),
      dayOfMonth: now.getUTCDate(),
      daysInMonth: lastDayOfMonth(now).getUTCDate(),
    });

    if (utilization.flags.includes("underused_commitment")) {
      await ensureFinanceWorkItem({
        contractId: contract.id,
        supplierId: contract.supplierId,
        ownerEmployeeId: contract.accountableEmployeeId ?? undefined,
        type: "underused_commitment",
        status: "open",
        severity: "medium",
        title: `Usage is tracking behind plan for ${contract.contractId}`,
        description: "Committed AI spend may go unused this cycle unless usage improves.",
      });
    }

    if (utilization.flags.includes("critical_low_allowance")) {
      await ensureFinanceWorkItem({
        contractId: contract.id,
        supplierId: contract.supplierId,
        ownerEmployeeId: contract.accountableEmployeeId ?? undefined,
        type: "critical_low_allowance",
        status: "open",
        severity: "critical",
        title: `Allowance is nearly exhausted for ${contract.contractId}`,
      });
    }

    return utilization;
  }));
}

export async function generateDraftBillForAiContract(input: {
  contract: {
    id: string;
    contractId: string;
    supplierId: string;
    currency: string;
    monthlyCommittedAmount: number | Prisma.Decimal | null;
    billingCadence: string;
    billingDayOfMonth?: number | null;
  };
  cycleDate?: Date;
}) {
  const cycleDate = input.cycleDate ?? new Date();
  const periodKey = cycleDate.toISOString().slice(0, 7);
  const billingDate = billingDateForCycle(cycleDate, input.contract.billingDayOfMonth);

  const existing = await prisma.bill.findFirst({
    where: {
      supplierId: input.contract.supplierId,
      status: "draft",
      invoiceRef: `${input.contract.contractId}-${periodKey}`,
    },
    select: { id: true, billRef: true },
  });
  if (existing) return existing;

  const totalAmount = Number(input.contract.monthlyCommittedAmount ?? 0);
  const bill = await prisma.bill.create({
    data: {
      billRef: `BILL-${new Date().getUTCFullYear()}-${newId(6).toUpperCase()}`,
      supplierId: input.contract.supplierId,
      supplierContractId: input.contract.id,
      status: "draft",
      invoiceRef: `${input.contract.contractId}-${periodKey}`,
      issueDate: billingDate,
      dueDate: billingDate,
      currency: input.contract.currency,
      subtotal: totalAmount,
      taxAmount: 0,
      totalAmount,
      amountPaid: 0,
      amountDue: totalAmount,
      notes: `Auto-generated from AI supplier contract ${input.contract.contractId}.`,
    },
    select: { id: true, billRef: true },
  });

  await prisma.billLineItem.createMany({
    data: [
      {
        billId: bill.id,
        description: "AI provider monthly commitment",
        quantity: 1,
        unitPrice: totalAmount,
        taxRate: 0,
        taxAmount: 0,
        lineTotal: totalAmount,
        accountCode: null,
        sortOrder: 0,
      },
    ],
  });

  return bill;
}
