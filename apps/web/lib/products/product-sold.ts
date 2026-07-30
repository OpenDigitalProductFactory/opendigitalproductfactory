import { newId } from "../shared/new-id";
export {
  persistProductSoldComponentAllocations,
  snapshotProductSoldComponents,
  transitionProductSoldByEvidence,
} from "./product-sold-commercial-persistence";
export { summarizeProductSoldRevenue } from "./commercial-performance";

export const PRODUCT_SOLD_STATUSES = [
  "purchased",
  "active",
  "fulfilled",
  "cancelled",
  "refunded",
] as const;
export type ProductSoldStatus = (typeof PRODUCT_SOLD_STATUSES)[number];

export const PRODUCT_SOLD_EVIDENCE_KINDS = [
  "quote-line",
  "sales-order",
  "storefront-order-line",
  "storefront-booking",
  "rental-agreement",
  "support-subscription",
] as const;
export type ProductSoldEvidenceKind =
  (typeof PRODUCT_SOLD_EVIDENCE_KINDS)[number];

export const PRODUCT_SOLD_PARTY_ROLES = [
  "account",
  "consumer",
  "subscriber",
] as const;
export type ProductSoldPartyRole = (typeof PRODUCT_SOLD_PARTY_ROLES)[number];

export const PRODUCT_FULFILLMENT_INSTANCE_KINDS = [
  "one-time-service",
  "booking",
  "physical-good",
  "rental",
  "supported-instance",
] as const;
export type ProductFulfillmentInstanceKind =
  (typeof PRODUCT_FULFILLMENT_INSTANCE_KINDS)[number];

type CommercialSelection = {
  organizationId: string;
  providerOrganizationId: string;
  product: {
    id: string;
    productId: string;
    name: string;
    organizationId: string;
  };
  offering: {
    id: string;
    offeringId: string;
    name: string;
    organizationId: string;
    providerOrganizationId: string;
  };
  catalogItem: {
    id: string;
    catalogItemId: string;
    name: string;
    organizationId: string;
  };
  catalogSku: {
    id: string;
    skuId: string;
    code: string;
    name?: string | null;
  } | null;
  configuration: {
    id: string;
    configurationId: string;
    name: string;
  } | null;
  priceListEntryId: string | null;
  promotionId: string | null;
  quantity: number;
  unitPrice: number | null;
  discountAmount: number | null;
  taxAmount: number | null;
  totalAmount: number;
  currency: string;
  purchasedAt: Date;
  configurationSnapshot: unknown;
  pricingSnapshot: Record<string, unknown>;
};

type TransactionEvidence = {
  kind: ProductSoldEvidenceKind;
  sourceId: string;
  sourceRef: string;
  observedAt: Date;
  snapshot: Record<string, unknown>;
};

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

export function frozenClone<T>(value: T): Readonly<T> {
  return deepFreeze(structuredClone(value));
}

function assertCommercialBoundary(selection: CommercialSelection): void {
  const organizationIds = [
    selection.organizationId,
    selection.product.organizationId,
    selection.offering.organizationId,
    selection.catalogItem.organizationId,
  ];
  if (new Set(organizationIds).size !== 1) {
    throw new Error("Commercial selection crosses organization boundaries");
  }
  if (
    selection.providerOrganizationId !==
    selection.offering.providerOrganizationId
  ) {
    throw new Error("Provider must come from the selected offering");
  }
  if (
    !Number.isFinite(selection.quantity) ||
    selection.quantity <= 0 ||
    !Number.isFinite(selection.totalAmount) ||
    selection.totalAmount < 0
  ) {
    throw new Error("Commercial selection has invalid quantity or amount");
  }
  if (!selection.currency.trim()) {
    throw new Error("Commercial selection requires a currency");
  }
}

export function createProductSoldSnapshot(selection: CommercialSelection) {
  assertCommercialBoundary(selection);
  const commercialSnapshot = frozenClone({
    version: 1 as const,
    providerOrganizationId: selection.providerOrganizationId,
    product: {
      productId: selection.product.productId,
      name: selection.product.name,
    },
    offering: {
      offeringId: selection.offering.offeringId,
      name: selection.offering.name,
      providerOrganizationId: selection.offering.providerOrganizationId,
    },
    catalogItem: {
      catalogItemId: selection.catalogItem.catalogItemId,
      name: selection.catalogItem.name,
    },
    catalogSku: selection.catalogSku
      ? {
          skuId: selection.catalogSku.skuId,
          code: selection.catalogSku.code,
          name: selection.catalogSku.name ?? null,
        }
      : null,
    configuration: selection.configuration
      ? {
          configurationId: selection.configuration.configurationId,
          name: selection.configuration.name,
        }
      : null,
    configurationSnapshot: selection.configurationSnapshot,
    purchasedAt: selection.purchasedAt.toISOString(),
  });
  const pricingSnapshot = frozenClone({
    version: 1 as const,
    ...selection.pricingSnapshot,
    quantity: selection.quantity,
    unitPrice: selection.unitPrice,
    discountAmount: selection.discountAmount,
    taxAmount: selection.taxAmount,
    totalAmount: selection.totalAmount,
    currency: selection.currency,
    priceListEntryId: selection.priceListEntryId,
    promotionId: selection.promotionId,
  });

  return { commercialSnapshot, pricingSnapshot };
}

export function createProductSoldDraft(input: {
  selection: CommercialSelection;
  evidence: TransactionEvidence;
}) {
  const { commercialSnapshot, pricingSnapshot } =
    createProductSoldSnapshot(input.selection);
  return {
    organizationId: input.selection.organizationId,
    providerOrganizationId: input.selection.providerOrganizationId,
    productId: input.selection.product.id,
    offeringId: input.selection.offering.id,
    catalogItemId: input.selection.catalogItem.id,
    catalogSkuId: input.selection.catalogSku?.id ?? null,
    configurationId: input.selection.configuration?.id ?? null,
    priceListEntryId: input.selection.priceListEntryId,
    promotionId: input.selection.promotionId,
    status: "purchased" as const,
    quantity: input.selection.quantity,
    unitPrice: input.selection.unitPrice,
    discountAmount: input.selection.discountAmount,
    taxAmount: input.selection.taxAmount,
    totalAmount: input.selection.totalAmount,
    currency: input.selection.currency,
    purchasedAt: input.selection.purchasedAt,
    configurationSnapshot: frozenClone(
      input.selection.configurationSnapshot,
    ),
    commercialSnapshot,
    pricingSnapshot,
    materializationKey: `${input.evidence.kind}:${input.evidence.sourceId}`,
    evidence: {
      kind: input.evidence.kind,
      sourceId: input.evidence.sourceId,
      sourceRef: input.evidence.sourceRef,
      observedAt: input.evidence.observedAt,
      snapshot: frozenClone(input.evidence.snapshot),
    },
  };
}

type CanonicalAccount = { id: string; accountId: string; name: string };
type CanonicalContact = {
  id: string;
  email: string;
  name: string | null;
};
type CanonicalSubscriber =
  | { kind: "account"; account: CanonicalAccount }
  | { kind: "contact"; contact: CanonicalContact };

export function createProductSoldPartyLinks(input: {
  evidenceId: string;
  observedAt: Date;
  account: CanonicalAccount | null;
  contact: CanonicalContact | null;
  subscriber: CanonicalSubscriber | null;
  evidenceSnapshot: Record<string, unknown>;
}) {
  const links: Array<{
    evidenceId: string;
    role: ProductSoldPartyRole;
    accountId: string | null;
    contactId: string | null;
    observedAt: Date;
    displaySnapshot: Readonly<Record<string, unknown>>;
  }> = [];

  if (input.account) {
    links.push({
      evidenceId: input.evidenceId,
      role: "account",
      accountId: input.account.id,
      contactId: null,
      observedAt: input.observedAt,
      displaySnapshot: frozenClone({
        accountId: input.account.accountId,
        name: input.account.name,
      }),
    });
  }
  if (input.contact) {
    links.push({
      evidenceId: input.evidenceId,
      role: "consumer",
      accountId: null,
      contactId: input.contact.id,
      observedAt: input.observedAt,
      displaySnapshot: frozenClone({
        email: input.contact.email,
        name: input.contact.name,
      }),
    });
  }
  if (input.subscriber?.kind === "account") {
    links.push({
      evidenceId: input.evidenceId,
      role: "subscriber",
      accountId: input.subscriber.account.id,
      contactId: null,
      observedAt: input.observedAt,
      displaySnapshot: frozenClone({
        accountId: input.subscriber.account.accountId,
        name: input.subscriber.account.name,
      }),
    });
  }
  if (input.subscriber?.kind === "contact") {
    links.push({
      evidenceId: input.evidenceId,
      role: "subscriber",
      accountId: null,
      contactId: input.subscriber.contact.id,
      observedAt: input.observedAt,
      displaySnapshot: frozenClone({
        email: input.subscriber.contact.email,
        name: input.subscriber.contact.name,
      }),
    });
  }

  // input.evidenceSnapshot intentionally remains only on transaction evidence.
  // It is never promoted into a canonical party without an account/contact ID.
  void input.evidenceSnapshot;
  return links;
}

type EntitlementInput = {
  kind: string;
  accountId: string | null;
  contactId: string | null;
  subscriptionId: string | null;
  quantity: number | null;
  rights: Record<string, unknown>;
  validFrom: Date;
  validTo: Date | null;
};

export function createProductSoldEntitlement(input: {
  evidenceId: string;
  entitlement: EntitlementInput | null;
}) {
  if (!input.entitlement) return null;
  if (
    Number(Boolean(input.entitlement.accountId)) +
      Number(Boolean(input.entitlement.contactId)) !==
    1
  ) {
    throw new Error("Entitlement requires one canonical beneficiary");
  }
  if (
    input.entitlement.validTo &&
    input.entitlement.validTo.getTime() <=
      input.entitlement.validFrom.getTime()
  ) {
    throw new Error("Entitlement validity must end after it starts");
  }
  return {
    entitlementKey: `${input.evidenceId}:${input.entitlement.kind}:${
      input.entitlement.accountId ?? input.entitlement.contactId
    }`,
    evidenceId: input.evidenceId,
    entitlementKind: input.entitlement.kind,
    accountId: input.entitlement.accountId,
    contactId: input.entitlement.contactId,
    subscriptionId: input.entitlement.subscriptionId,
    quantity: input.entitlement.quantity,
    rightSnapshot: frozenClone(input.entitlement.rights),
    validFrom: input.entitlement.validFrom,
    validTo: input.entitlement.validTo,
  };
}

type FulfillmentTargets = {
  storefrontBookingId: string | null;
  rentalAgreementId: string | null;
  rentableUnitId: string | null;
  edgeNodeId: string | null;
};

export function createTypedFulfillmentInstance(input: {
  evidenceId: string;
  kind: ProductFulfillmentInstanceKind;
  status: ProductSoldStatus;
  targets: FulfillmentTargets;
  snapshot: Record<string, unknown>;
}) {
  if (!Object.values(input.targets).some(Boolean)) {
    throw new Error("Fulfillment instance requires a typed target");
  }
  const targetKey = [
    ["storefrontBookingId", input.targets.storefrontBookingId],
    ["rentalAgreementId", input.targets.rentalAgreementId],
    ["rentableUnitId", input.targets.rentableUnitId],
    ["edgeNodeId", input.targets.edgeNodeId],
  ]
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
  return {
    instanceKey: `${input.evidenceId}:${input.kind}:${targetKey}`,
    evidenceId: input.evidenceId,
    instanceKind: input.kind,
    status: input.status,
    ...input.targets,
    fulfillmentSnapshot: frozenClone(input.snapshot),
  };
}

const ALLOWED_TRANSITIONS: Readonly<
  Record<ProductSoldStatus, readonly ProductSoldStatus[]>
> = {
  purchased: ["active", "fulfilled", "cancelled", "refunded"],
  active: ["fulfilled", "cancelled", "refunded"],
  fulfilled: ["refunded"],
  cancelled: [],
  refunded: [],
};

export function transitionProductSold<
  T extends {
    status: ProductSoldStatus;
    commercialSnapshot: Readonly<unknown>;
    pricingSnapshot: Readonly<unknown>;
    cancelledAt: Date | null;
    refundedAt: Date | null;
  },
>(
  current: T,
  transition: { to: ProductSoldStatus; occurredAt: Date },
): T {
  if (!ALLOWED_TRANSITIONS[current.status].includes(transition.to)) {
    throw new Error(
      `Product Sold cannot transition from ${current.status} to ${transition.to}`,
    );
  }
  return {
    ...current,
    status: transition.to,
    cancelledAt:
      transition.to === "cancelled"
        ? transition.occurredAt
        : current.cancelledAt,
    refundedAt:
      transition.to === "refunded"
        ? transition.occurredAt
        : current.refundedAt,
  };
}

type ProductSoldWriteClient = {
  productSold: {
    upsert(input: unknown): Promise<{
      id: string;
      productSoldId: string;
      evidence: Array<{ id: string }>;
    }>;
  };
};

export function evidenceSourceData(
  kind: ProductSoldEvidenceKind,
  sourceId: string,
): Record<string, string> {
  switch (kind) {
    case "quote-line":
      return { quoteLineItemId: sourceId };
    case "sales-order":
      return { salesOrderId: sourceId };
    case "storefront-order-line":
      return { storefrontOrderLineItemId: sourceId };
    case "storefront-booking":
      return { storefrontBookingId: sourceId };
    case "rental-agreement":
      return { rentalAgreementId: sourceId };
    case "support-subscription":
      return { subscriptionId: sourceId };
  }
}

export async function materializeProductSold(input: {
  db: ProductSoldWriteClient;
  draft: ReturnType<typeof createProductSoldDraft>;
}): Promise<{ id: string; productSoldId: string; evidenceId: string }> {
  const draft = input.draft;
  const source = evidenceSourceData(
    draft.evidence.kind,
    draft.evidence.sourceId,
  );
  const result = await input.db.productSold.upsert({
    where: { materializationKey: draft.materializationKey },
    create: {
      productSoldId: `PS-${newId(8).toUpperCase()}`,
      materializationKey: draft.materializationKey,
      organizationId: draft.organizationId,
      providerOrganizationId: draft.providerOrganizationId,
      productId: draft.productId,
      offeringId: draft.offeringId,
      catalogItemId: draft.catalogItemId,
      catalogSkuId: draft.catalogSkuId,
      configurationId: draft.configurationId,
      priceListEntryId: draft.priceListEntryId,
      promotionId: draft.promotionId,
      status: draft.status,
      quantity: draft.quantity,
      unitPrice: draft.unitPrice,
      discountAmount: draft.discountAmount,
      taxAmount: draft.taxAmount,
      totalAmount: draft.totalAmount,
      currency: draft.currency,
      purchasedAt: draft.purchasedAt,
      configurationSnapshot: draft.configurationSnapshot,
      pricingSnapshot: draft.pricingSnapshot,
      commercialSnapshot: draft.commercialSnapshot,
      sourceKind: draft.evidence.kind,
      sourceRef: draft.evidence.sourceRef,
      evidence: {
        create: {
          evidenceId: `EVID-${newId(8).toUpperCase()}`,
          organizationId: draft.organizationId,
          evidenceKind: draft.evidence.kind,
          ...source,
          observedAt: draft.evidence.observedAt,
          evidenceSnapshot: draft.evidence.snapshot,
          sourceKind: draft.evidence.kind,
          sourceRef: draft.evidence.sourceRef,
        },
      },
    },
    update: {},
    select: {
      id: true,
      productSoldId: true,
      evidence: {
        where: source,
        select: { id: true },
        take: 1,
      },
    },
  });
  const evidenceId = result.evidence[0]?.id;
  if (!evidenceId) {
    throw new Error("Product Sold materialization lost its source evidence");
  }
  return {
    id: result.id,
    productSoldId: result.productSoldId,
    evidenceId,
  };
}

type ProductSoldEvidenceWriteClient = {
  productSoldEvidence: {
    upsert(input: unknown): Promise<{ id: string }>;
  };
};

function evidenceUniqueWhere(input: {
  productSoldId: string;
  kind: ProductSoldEvidenceKind;
  sourceId: string;
}): Record<string, unknown> {
  switch (input.kind) {
    case "quote-line":
      return { quoteLineItemId: input.sourceId };
    case "storefront-order-line":
      return { storefrontOrderLineItemId: input.sourceId };
    case "storefront-booking":
      return { storefrontBookingId: input.sourceId };
    case "rental-agreement":
      return { rentalAgreementId: input.sourceId };
    case "sales-order":
      return {
        productSoldId_salesOrderId: {
          productSoldId: input.productSoldId,
          salesOrderId: input.sourceId,
        },
      };
    case "support-subscription":
      return {
        productSoldId_subscriptionId: {
          productSoldId: input.productSoldId,
          subscriptionId: input.sourceId,
        },
      };
  }
}

export async function appendProductSoldEvidence(input: {
  db: ProductSoldEvidenceWriteClient;
  organizationId: string;
  productSoldId: string;
  kind: ProductSoldEvidenceKind;
  sourceId: string;
  sourceRef: string;
  observedAt: Date;
  snapshot: Record<string, unknown>;
}): Promise<{ id: string }> {
  return input.db.productSoldEvidence.upsert({
    where: evidenceUniqueWhere(input),
    create: {
      evidenceId: `EVID-${newId(8).toUpperCase()}`,
      organizationId: input.organizationId,
      productSoldId: input.productSoldId,
      evidenceKind: input.kind,
      ...evidenceSourceData(input.kind, input.sourceId),
      observedAt: input.observedAt,
      evidenceSnapshot: frozenClone(input.snapshot),
      sourceKind: input.kind,
      sourceRef: input.sourceRef,
    },
    update: {
      observedAt: input.observedAt,
      evidenceSnapshot: frozenClone(input.snapshot),
      sourceRef: input.sourceRef,
    },
    select: { id: true },
  });
}

type ProductSoldPartyWriteClient = {
  productSoldParty: {
    upsert(input: unknown): Promise<{ id: string }>;
  };
};

export async function persistProductSoldPartyLinks(input: {
  db: ProductSoldPartyWriteClient;
  organizationId: string;
  productSoldId: string;
  links: ReturnType<typeof createProductSoldPartyLinks>;
}): Promise<void> {
  for (const link of input.links) {
    const where = link.accountId
      ? {
          productSoldId_role_accountId: {
            productSoldId: input.productSoldId,
            role: link.role,
            accountId: link.accountId,
          },
        }
      : {
          productSoldId_role_contactId: {
            productSoldId: input.productSoldId,
            role: link.role,
            contactId: link.contactId!,
          },
        };
    await input.db.productSoldParty.upsert({
      where,
      create: {
        partyId: `PARTY-${newId(8).toUpperCase()}`,
        organizationId: input.organizationId,
        productSoldId: input.productSoldId,
        evidenceId: link.evidenceId,
        role: link.role,
        accountId: link.accountId,
        contactId: link.contactId,
        observedAt: link.observedAt,
        displaySnapshot: link.displaySnapshot,
      },
      update: {
        evidenceId: link.evidenceId,
        observedAt: link.observedAt,
        displaySnapshot: link.displaySnapshot,
      },
      select: { id: true },
    });
  }
}

type ProductSoldEntitlementWriteClient = {
  productSoldEntitlement: {
    upsert(input: unknown): Promise<{ id: string }>;
  };
};

export async function persistProductSoldEntitlement(input: {
  db: ProductSoldEntitlementWriteClient;
  organizationId: string;
  productSoldId: string;
  entitlement: ReturnType<typeof createProductSoldEntitlement>;
}): Promise<{ id: string } | null> {
  const entitlement = input.entitlement;
  if (!entitlement) return null;
  return input.db.productSoldEntitlement.upsert({
    where: { entitlementKey: entitlement.entitlementKey },
    create: {
      entitlementId: `ENT-${newId(8).toUpperCase()}`,
      entitlementKey: entitlement.entitlementKey,
      organizationId: input.organizationId,
      productSoldId: input.productSoldId,
      evidenceId: entitlement.evidenceId,
      accountId: entitlement.accountId,
      contactId: entitlement.contactId,
      subscriptionId: entitlement.subscriptionId,
      entitlementKind: entitlement.entitlementKind,
      status: "active",
      quantity: entitlement.quantity,
      rightSnapshot: entitlement.rightSnapshot,
      validFrom: entitlement.validFrom,
      validTo: entitlement.validTo,
    },
    update: {
      status: "active",
      validTo: entitlement.validTo,
    },
    select: { id: true },
  });
}

type ProductFulfillmentInstanceWriteClient = {
  productFulfillmentInstance: {
    upsert(input: unknown): Promise<{ id: string }>;
  };
};

export async function persistProductFulfillmentInstance(input: {
  db: ProductFulfillmentInstanceWriteClient;
  organizationId: string;
  productSoldId: string;
  instance: ReturnType<typeof createTypedFulfillmentInstance>;
}): Promise<{ id: string }> {
  const instance = input.instance;
  return input.db.productFulfillmentInstance.upsert({
    where: { instanceKey: instance.instanceKey },
    create: {
      instanceId: `INSTANCE-${newId(8).toUpperCase()}`,
      instanceKey: instance.instanceKey,
      organizationId: input.organizationId,
      productSoldId: input.productSoldId,
      evidenceId: instance.evidenceId,
      instanceKind: instance.instanceKind,
      status: instance.status,
      storefrontBookingId: instance.storefrontBookingId,
      rentalAgreementId: instance.rentalAgreementId,
      rentableUnitId: instance.rentableUnitId,
      edgeNodeId: instance.edgeNodeId,
      fulfillmentSnapshot: instance.fulfillmentSnapshot,
    },
    update: {
      status: instance.status,
    },
    select: { id: true },
  });
}
