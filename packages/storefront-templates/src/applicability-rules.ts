import {
  CAPABILITY_KEYS,
  CAPABILITY_REGISTRY,
  type CapabilityKey,
  isCapabilityKey,
} from "./capability-registry";
import type {
  BillingPatternProfile,
  CapabilityActivation,
  CapabilityApplicability,
  CapabilityOverride,
  CommercialModel,
  OperatingModelAxes,
  PartnerProgramProfile,
  PortfolioDecomposition,
} from "./types";

type CapabilityMap = Map<CapabilityKey, CapabilityActivation>;

interface RuleResult {
  key: CapabilityKey;
  applicability: CapabilityApplicability;
  reason: string;
  ownershipScopes?: CapabilityActivation["ownershipScopes"];
  transactionContexts?: CapabilityActivation["transactionContexts"];
  isolation?: CapabilityActivation["isolation"];
}

interface ApplicabilityRule {
  name: string;
  evaluate: (axes: OperatingModelAxes, portfolios: PortfolioDecomposition) => RuleResult[];
}

function createBaseCapabilityMap(): CapabilityMap {
  const map = new Map<CapabilityKey, CapabilityActivation>();

  for (const key of CAPABILITY_KEYS) {
    const registryEntry = CAPABILITY_REGISTRY[key];
    map.set(key, {
      capabilityKey: key,
      applicability:
        key === "edge-node-customer-deployment" || key === "remote-support"
          ? "hidden"
          : "not-applicable",
      ownershipScopes: [registryEntry.defaultOwnershipScope],
      isolation: registryEntry.defaultIsolation,
      surfaces: [...registryEntry.surfaces],
      sourceRules: [],
    });
  }

  return map;
}

function applyRuleResult(map: CapabilityMap, ruleName: string, result: RuleResult): void {
  const existing = map.get(result.key);
  if (!existing) return;

  map.set(result.key, {
    ...existing,
    applicability: result.applicability,
    ownershipScopes: result.ownershipScopes ?? existing.ownershipScopes,
    transactionContexts: result.transactionContexts ?? existing.transactionContexts,
    isolation: result.isolation ?? existing.isolation,
    reason: result.reason,
    sourceRules: [...existing.sourceRules, ruleName],
  });
}

function isManagedExternalEstate(
  axes: OperatingModelAxes,
  portfolios: PortfolioDecomposition,
): boolean {
  return (
    axes.primaryConsumer === "business" &&
    portfolios.manufactureAndDeliver.scope === "primary"
  );
}

function isRecurringPropertyOrAssociation(axes: OperatingModelAxes): boolean {
  return (
    axes.commercialModel === "recurring-agreement" &&
    axes.delivery === "physical" &&
    (axes.primaryConsumer === "household" || axes.primaryConsumer === "business")
  );
}

function hasDetectToCorrect(portfolios: PortfolioDecomposition): boolean {
  return portfolios.manufactureAndDeliver.it4itStages?.includes("detect-to-correct") ?? false;
}

const RULES: ApplicabilityRule[] = [
  {
    name: "customer-accounts-from-external-consumer",
    evaluate: (axes) => {
      if (axes.primaryConsumer === "business" || axes.primaryConsumer === "household") {
        return [
          {
            key: "customer-accounts",
            applicability: "required",
            reason: "External business or household customers need account records.",
            ownershipScopes: ["customer-account"],
          },
        ];
      }

      if (axes.primaryConsumer === "individual") {
        return [
          {
            key: "customer-accounts",
            applicability: "recommended",
            reason: "Individual services benefit from client records without making estate scope mandatory.",
            ownershipScopes: ["organization"],
            isolation: "organization-scope",
          },
        ];
      }

      return [];
    },
  },
  {
    name: "managed-external-estate",
    evaluate: (axes, portfolios) => {
      if (!isManagedExternalEstate(axes, portfolios)) return [];

      return [
        {
          key: "customer-sites",
          applicability: "required",
          reason: "Managed external estates need customer site boundaries.",
          ownershipScopes: ["customer-account", "customer-site"],
          isolation: "strict-customer-scope",
        },
        {
          key: "customer-estate",
          applicability: "required",
          reason: "B2B primary manufacture/delivery work manages customer estate records.",
          ownershipScopes: ["customer-account", "customer-site"],
          isolation: "strict-customer-scope",
        },
        {
          key: "project-work",
          applicability: "required",
          reason: "Managed services produce onboarding, remediation, and migration projects.",
          ownershipScopes: ["customer-account"],
          isolation: "strict-customer-scope",
        },
      ];
    },
  },
  {
    name: "detect-to-correct-estate-operations",
    evaluate: (axes, portfolios) => {
      if (!isManagedExternalEstate(axes, portfolios) || !hasDetectToCorrect(portfolios)) {
        return [];
      }

      return [
        {
          key: "edge-node-customer-deployment",
          applicability: "required",
          reason: "Detect-to-correct managed services need customer-scoped local telemetry.",
          ownershipScopes: ["edge-node", "customer-site"],
          isolation: "strict-customer-scope",
        },
        {
          key: "network-inventory",
          applicability: "required",
          reason: "Detect-to-correct managed services need network inventory.",
          ownershipScopes: ["customer-site", "configuration-item"],
          isolation: "strict-customer-scope",
        },
        {
          key: "cybersecurity-posture",
          applicability: "required",
          reason: "Managed customer operations include cybersecurity posture review.",
          ownershipScopes: ["customer-account", "configuration-item"],
          isolation: "strict-customer-scope",
        },
        {
          key: "backup-restore-posture",
          applicability: "required",
          reason: "Managed customer operations include backup and restore posture.",
          ownershipScopes: ["customer-account", "configuration-item"],
          isolation: "strict-customer-scope",
        },
        {
          key: "lifecycle-review-queues",
          applicability: "required",
          reason: "Managed estate operations need lifecycle review queues.",
          ownershipScopes: ["customer-account", "configuration-item"],
          isolation: "strict-customer-scope",
        },
      ];
    },
  },
  {
    name: "recurring-agreement-commercial-model",
    evaluate: (axes) => {
      if (axes.commercialModel !== "recurring-agreement") return [];

      return [
        {
          key: "service-agreements",
          applicability: "required",
          reason: "Recurring agreement commercial models require service agreements.",
          ownershipScopes: ["customer-account"],
          transactionContexts: ["service-agreement"],
        },
        {
          key: "recurring-agreement-billing",
          applicability: "required",
          reason: "Recurring agreements require billing-period readiness.",
          ownershipScopes: ["customer-account"],
          transactionContexts: ["billing-period"],
        },
        {
          key: "billing-readiness",
          applicability: "required",
          reason: "Recurring agreements require invoice-ready period preparation.",
          ownershipScopes: ["customer-account"],
          transactionContexts: ["billing-period"],
        },
      ];
    },
  },
  {
    name: "appointment-checkout-commercial-model",
    evaluate: (axes) => {
      if (axes.commercialModel !== "appointment-checkout") return [];

      return [
        {
          key: "appointment-checkout",
          applicability: "required",
          reason: "Appointment checkout is the primary payment motion.",
          ownershipScopes: ["organization"],
          transactionContexts: ["appointment"],
          isolation: "organization-scope",
        },
        {
          key: "point-of-sale",
          applicability: "required",
          reason: "In-person appointment services usually settle through point-of-sale.",
          ownershipScopes: ["organization"],
          transactionContexts: ["appointment"],
          isolation: "organization-scope",
        },
        {
          key: "recurring-agreement-billing",
          applicability: "optional",
          reason: "Packages or memberships are optional, not the main salon workflow.",
          ownershipScopes: ["organization"],
          transactionContexts: ["billing-period"],
          isolation: "organization-scope",
        },
      ];
    },
  },
  {
    name: "point-of-sale-commercial-model",
    evaluate: (axes) => {
      if (axes.commercialModel !== "point-of-sale") return [];

      return [
        {
          key: "point-of-sale",
          applicability: "required",
          reason: "Point-of-sale is the primary payment motion.",
          ownershipScopes: ["organization"],
          transactionContexts: ["order"],
          isolation: "organization-scope",
        },
        {
          key: "customer-estate",
          applicability: "optional",
          reason: "Retail can track internal store equipment without customer-estate requirements.",
          ownershipScopes: ["organization"],
          isolation: "organization-scope",
        },
      ];
    },
  },
  {
    name: "baseline-business-resilience",
    evaluate: (axes) => {
      if (axes.commercialModel === "recurring-agreement" && axes.primaryConsumer === "business") {
        return [];
      }

      return [
        {
          key: "cybersecurity-posture",
          applicability: "recommended",
          reason: "Every small business benefits from security posture awareness.",
          ownershipScopes: ["organization"],
          isolation: "organization-scope",
        },
        {
          key: "backup-restore-posture",
          applicability: "recommended",
          reason: "Every small business benefits from backup and recovery awareness.",
          ownershipScopes: ["organization"],
          isolation: "organization-scope",
        },
      ];
    },
  },
  {
    name: "property-or-association-estate",
    evaluate: (axes) => {
      if (!isRecurringPropertyOrAssociation(axes)) return [];

      return [
        {
          key: "customer-sites",
          applicability: "required",
          reason: "Recurring property or association operations need managed site boundaries.",
          ownershipScopes: ["customer-account", "customer-site"],
        },
        {
          key: "customer-estate",
          applicability: "optional",
          reason: "Property assets are useful but not always IT configuration items.",
          ownershipScopes: ["customer-account", "customer-site"],
        },
        {
          key: "edge-node-customer-deployment",
          applicability: "optional",
          reason: "Facilities monitoring may use edge nodes later.",
          ownershipScopes: ["customer-site", "edge-node"],
        },
        {
          key: "network-inventory",
          applicability: "optional",
          reason: "Facilities may need network visibility when common-area systems exist.",
          ownershipScopes: ["customer-site"],
        },
        {
          key: "project-work",
          applicability: "required",
          reason: "Property management frequently runs managed projects and remediation work.",
          ownershipScopes: ["customer-account"],
        },
        {
          key: "lifecycle-review-queues",
          applicability: "required",
          reason: "Recurring property agreements need lifecycle review queues.",
          ownershipScopes: ["customer-account", "customer-site"],
        },
        {
          key: "remote-support",
          applicability: "optional",
          reason: "Remote assistance can apply to managed facilities with consent.",
          ownershipScopes: ["customer-account"],
        },
      ];
    },
  },
  {
    name: "non-primary-checkout-surfaces",
    evaluate: (axes) => {
      if (axes.commercialModel === "appointment-checkout" || axes.commercialModel === "point-of-sale") {
        return [];
      }

      return [
        {
          key: "appointment-checkout",
          applicability: axes.commercialModel === "recurring-agreement" ? "hidden" : "optional",
          reason: "Appointment checkout is not the primary motion.",
          ownershipScopes: ["organization"],
          isolation: "organization-scope",
        },
        {
          key: "point-of-sale",
          applicability: "optional",
          reason: "Point-of-sale can support incidental payments.",
          ownershipScopes: ["organization"],
          isolation: "organization-scope",
        },
      ];
    },
  },
  {
    // governance is optional on raw axes (normalizer defaults it to
    // "investor-owned"); strict equality means absent === no civic machinery.
    name: "member-owned-governance",
    evaluate: (axes) => {
      if (axes.governance !== "member-owned") return [];

      return [
        {
          key: "member-governance",
          applicability: "required",
          reason: "Member-owned organizations run an elected board, committees, and an annual meeting.",
          ownershipScopes: ["organization"],
          isolation: "organization-scope",
        },
        {
          key: "membership-eligibility",
          applicability: "required",
          reason: "Member-owned organizations admit members through an eligibility step before account creation.",
          ownershipScopes: ["organization"],
          isolation: "organization-scope",
        },
        {
          key: "member-equity",
          applicability: "recommended",
          reason: "Member-owned organizations commonly allocate patronage or member equity; cooperatives require it.",
          ownershipScopes: ["customer-account"],
          isolation: "organization-scope",
        },
      ];
    },
  },
  {
    name: "public-body-governance",
    evaluate: (axes) => {
      if (axes.governance !== "public-body") return [];

      return [
        {
          key: "public-body-governance",
          applicability: "required",
          reason: "Public bodies operate under open-meetings law: agendas, meetings, minutes, publication.",
          ownershipScopes: ["organization"],
          isolation: "organization-scope",
        },
        {
          key: "records-request",
          applicability: "required",
          reason: "Public bodies answer statutory records requests with deadline tracking.",
          ownershipScopes: ["organization"],
          isolation: "organization-scope",
        },
      ];
    },
  },
  {
    name: "resident-service-obligation",
    evaluate: (axes) => {
      if (axes.primaryConsumer !== "resident") return [];

      return [
        {
          key: "service-request-311",
          applicability: "required",
          reason: "Residents file service requests the jurisdiction must route and answer for everyone equally.",
          ownershipScopes: ["organization"],
          isolation: "organization-scope",
        },
        {
          key: "customer-accounts",
          applicability: "required",
          reason: "Residents and ratepayers need account records; the relationship is jurisdictional, not contractual.",
          ownershipScopes: ["customer-account"],
          isolation: "organization-scope",
        },
      ];
    },
  },
  {
    name: "member-eligibility-before-account",
    evaluate: (axes) => {
      if (axes.primaryConsumer !== "member") return [];

      return [
        {
          key: "customer-accounts",
          applicability: "required",
          reason: "Members need account records bound to their membership.",
          ownershipScopes: ["customer-account"],
          isolation: "organization-scope",
        },
        {
          key: "membership-eligibility",
          applicability: "required",
          reason: "Membership eligibility is checked before a member account is created.",
          ownershipScopes: ["organization"],
          isolation: "organization-scope",
        },
      ];
    },
  },
  {
    // Rental / shared-asset operating model (asset-rental archetypes + the
    // agricultural shared-machinery co-op). The reservation-and-return
    // provisioning value is the axis signal — distinct from usage-based billing
    // alone (a municipal utility is usage-based but not a rental pool).
    name: "reservation-and-return-rental",
    evaluate: (axes) => {
      if (axes.provisioning !== "reservation-and-return") return [];

      return [
        {
          key: "rental-fleet",
          applicability: "required",
          reason: "Rental operators manage a pool of reusable assets with live state and availability.",
          ownershipScopes: ["organization"],
          isolation: "organization-scope",
        },
        {
          key: "rental-agreements",
          applicability: "required",
          reason: "Rentals run a reserve → checkout → return & inspect → re-pool lifecycle with deposits.",
          ownershipScopes: ["organization"],
          isolation: "organization-scope",
        },
        {
          key: "asset-pool",
          applicability: "required",
          reason: "Asset-utilization %, turnaround, reservation conflicts, and overdue returns are the load-bearing KPIs.",
          ownershipScopes: ["organization"],
          isolation: "organization-scope",
        },
      ];
    },
  },
  {
    // Goods-custody operating model (warehousing-fulfilment archetypes). The
    // custody-and-fulfilment provisioning value is the axis signal — the mirror
    // of reservation-and-return, and distinct from a goods business that simply
    // holds stock (wholesale-distribution owns what is on its racks; a 3PL does
    // not).
    name: "custody-and-fulfilment-warehousing",
    evaluate: (axes) => {
      if (axes.provisioning !== "custody-and-fulfilment") return [];

      return [
        {
          key: "goods-custody",
          applicability: "required",
          reason:
            "Custody operators hold stock they do not own and are liable for it — the ledger is per owning client, by location, lot, serial, and expiry.",
          ownershipScopes: ["customer-account"],
          isolation: "strict-customer-scope",
        },
        {
          key: "warehouse-operations",
          applicability: "required",
          reason:
            "Receive → put-away → pick → pack → despatch, plus cycle counting and dock appointments, is the operating loop being run.",
          ownershipScopes: ["organization"],
          transactionContexts: ["order"],
          isolation: "organization-scope",
        },
        {
          key: "storage-and-handling-billing",
          applicability: "recommended",
          reason:
            "Storage rent and handling are two meters on one account, on a rate card with minimums and accessorials; fulfilment-only operators may bill per order alone.",
          ownershipScopes: ["customer-account"],
          transactionContexts: ["billing-period"],
          isolation: "strict-customer-scope",
        },
        {
          key: "customer-sites",
          applicability: "required",
          reason:
            "Goods are received from and despatched to specific client sites; the site is the address on the receipt and the BOL.",
          ownershipScopes: ["customer-account", "customer-site"],
          isolation: "strict-customer-scope",
        },
      ];
    },
  },
  {
    name: "partner-channel-from-axes",
    evaluate: (axes, portfolios) => {
      const program = derivePartnerProgramProfile(axes, portfolios);
      if (program.portalMode === "none") return [];

      return [
        {
          key: "partner-program",
          applicability: program.portalMode === "primary" ? "required" : "recommended",
          reason:
            program.portalMode === "primary"
              ? "A channel-partner primary consumer sells through a partner/reseller network."
              : "Platform/ecosystem, managed-service, and wholesale models commonly run a partner channel alongside direct sales.",
          ownershipScopes: ["partner-account"],
          isolation: "strict-partner-scope",
        },
      ];
    },
  },
];

function applyOverrides(map: CapabilityMap, overrides: CapabilityOverride[]): void {
  for (const override of overrides) {
    if (!isCapabilityKey(override.capabilityKey)) {
      continue;
    }

    const existing = map.get(override.capabilityKey);
    if (!existing) continue;

    map.set(override.capabilityKey, {
      ...existing,
      applicability: override.applicability,
      ownershipScopes: override.ownershipScopes ?? existing.ownershipScopes,
      transactionContexts: override.transactionContexts ?? existing.transactionContexts,
      isolation: override.isolation ?? existing.isolation,
      surfaces: override.surfaces ?? existing.surfaces,
      overrideReason: override.reason,
      sourceRules: [...existing.sourceRules, "capability-override"],
    });
  }
}

export function deriveCapabilityApplicability(
  axes: OperatingModelAxes,
  portfolios: PortfolioDecomposition,
  overrides: CapabilityOverride[] = [],
): CapabilityMap {
  const map = createBaseCapabilityMap();

  for (const rule of RULES) {
    for (const result of rule.evaluate(axes, portfolios)) {
      applyRuleResult(map, rule.name, result);
    }
  }

  applyOverrides(map, overrides);

  return map;
}

function supportedPatternsForCommercialModel(commercialModel: CommercialModel): BillingPatternProfile {
  switch (commercialModel) {
    case "recurring-agreement":
      return {
        primaryPaymentPattern: "recurring-agreement",
        supportedPaymentPatterns: [
          "recurring-agreement",
          "project-milestone",
          "ad-hoc-invoice",
          "usage-based",
        ],
        invoiceExecutionMode: "prepared-not-prescribed",
        recurringBillingApplicability: "required",
      };
    case "appointment-checkout":
      return {
        primaryPaymentPattern: "appointment-checkout",
        supportedPaymentPatterns: ["appointment-checkout", "point-of-sale", "optional-package"],
        invoiceExecutionMode: "manual",
        recurringBillingApplicability: "optional",
      };
    case "point-of-sale":
    case "transactional":
      return {
        primaryPaymentPattern: "point-of-sale",
        supportedPaymentPatterns: ["point-of-sale", "ad-hoc-invoice"],
        invoiceExecutionMode: "manual",
        recurringBillingApplicability: "optional",
      };
    case "subscription":
      return {
        primaryPaymentPattern: "subscription",
        supportedPaymentPatterns: ["subscription", "ad-hoc-invoice"],
        invoiceExecutionMode: "prepared-not-prescribed",
        recurringBillingApplicability: "required",
      };
    case "usage-based":
      return {
        primaryPaymentPattern: "usage-based",
        supportedPaymentPatterns: ["usage-based", "subscription", "ad-hoc-invoice"],
        invoiceExecutionMode: "prepared-not-prescribed",
        recurringBillingApplicability: "recommended",
      };
    case "account-based-fees":
      return {
        primaryPaymentPattern: "retainer",
        supportedPaymentPatterns: ["retainer", "ad-hoc-invoice"],
        invoiceExecutionMode: "prepared-not-prescribed",
        recurringBillingApplicability: "recommended",
      };
    case "encounter-based":
      return {
        primaryPaymentPattern: "ad-hoc-invoice",
        supportedPaymentPatterns: ["ad-hoc-invoice"],
        invoiceExecutionMode: "manual",
        recurringBillingApplicability: "optional",
      };
    case "statutory-fees-and-levies":
      // A levy/assessment is an obligation-driven invoice on a published fee
      // schedule — no new PaymentPattern value (civic archetypes spec §7 note 1).
      return {
        primaryPaymentPattern: "ad-hoc-invoice",
        supportedPaymentPatterns: ["ad-hoc-invoice", "recurring-agreement"],
        invoiceExecutionMode: "prepared-not-prescribed",
        recurringBillingApplicability: "optional",
      };
    case "hybrid":
      return {
        primaryPaymentPattern: "ad-hoc-invoice",
        supportedPaymentPatterns: ["ad-hoc-invoice", "subscription", "usage-based"],
        invoiceExecutionMode: "manual",
        recurringBillingApplicability: "recommended",
      };
  }
}

export function deriveBillingPatternProfile(axes: OperatingModelAxes): BillingPatternProfile {
  return supportedPatternsForCommercialModel(axes.commercialModel);
}

const NO_PARTNER_PROGRAM: PartnerProgramProfile = {
  portalMode: "none",
  partnerTypes: [],
  tiers: [],
  dealRegistration: false,
  partnerGraph: "none",
};

/**
 * Derives the partner/reseller operating model from the operating-model axes,
 * the same way {@link deriveBillingPatternProfile} derives billing from
 * `commercialModel`. Partner support is therefore a function of an archetype's
 * axis values, not a hand-authored per-archetype flag — adding the 50th
 * archetype to a partner channel is a matter of its axes, not a new rule.
 *
 * Precedence (first match wins):
 *  1. `primaryConsumer === "channel-partner"` — selling *through* partners is the
 *     primary motion → partner portal is primary, downstream projection on.
 *  2. platform/ecosystem play (`platform !== "no"`) — SaaS/marketplace partner
 *     program alongside direct sales.
 *  3. managed service provider (B2B + recurring-agreement + primary delivery) —
 *     MSPs are themselves channel partners and may sub-contract.
 *  4. wholesale/distribution (physical goods sold to business buyers who resell).
 */
export function derivePartnerProgramProfile(
  axes: OperatingModelAxes,
  portfolios: PortfolioDecomposition,
): PartnerProgramProfile {
  if (axes.primaryConsumer === "channel-partner") {
    return {
      portalMode: "primary",
      partnerTypes: ["reseller", "distributor", "managed-service-provider"],
      tiers: ["registered", "authorized", "silver", "gold", "platinum"],
      dealRegistration: true,
      partnerGraph: "separate-partner-projection",
    };
  }

  if (axes.platform === "yes-marketplace" || axes.platform === "yes-developer") {
    return {
      portalMode: "available",
      partnerTypes: ["referral", "reseller", "technology"],
      tiers: ["registered", "silver", "gold", "platinum"],
      dealRegistration: true,
      partnerGraph: "separate-partner-projection",
    };
  }

  if (
    axes.primaryConsumer === "business" &&
    axes.commercialModel === "recurring-agreement" &&
    portfolios.manufactureAndDeliver.scope === "primary"
  ) {
    return {
      portalMode: "available",
      partnerTypes: ["managed-service-provider", "technology"],
      tiers: ["registered", "authorized"],
      dealRegistration: true,
      partnerGraph: "none",
    };
  }

  if (axes.form === "goods" && axes.primaryConsumer === "business") {
    return {
      portalMode: "available",
      partnerTypes: ["reseller", "distributor"],
      tiers: ["registered", "authorized"],
      dealRegistration: false,
      partnerGraph: "separate-partner-projection",
    };
  }

  return NO_PARTNER_PROGRAM;
}
