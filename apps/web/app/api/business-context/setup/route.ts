import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma, type Prisma } from "@dpf/db";
import { parseOrgAddress, sanitizeOrgAddressInput, serializeOrgAddress } from "@/lib/shared/org-address";
import { isRiskPosture } from "@/lib/govern/risk-posture";
import { applyRiskEnvelopeToOrgProfile } from "@/lib/onboarding/apply-risk-envelope-to-profile";
import { isDataHandlingPredicate } from "@dpf/db/regulation-applicability";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    description,
    mission,
    targetMarket,
    sourceSystem,
    companySize,
    geographicScope,
    revenueModel,
    contactEmail,
    contactPhone,
    operatesIn,
    sellsTo,
    employsIn,
    dataResidency,
    handlesCardPayments,
    dataHandling,
    listingStatus,
    riskPosture,
    address,
  } = (await req.json()) as {
    description?: string;
    mission?: string;
    targetMarket?: string;
    sourceSystem?: string;
    companySize?: string;
    geographicScope?: string;
    revenueModel?: string;
    contactEmail?: string;
    contactPhone?: string;
    operatesIn?: string[];
    sellsTo?: string[];
    employsIn?: string[];
    dataResidency?: string[];
    handlesCardPayments?: boolean;
    dataHandling?: string[];
    listingStatus?: string | null;
    riskPosture?: string;
    address?: unknown;
  };

  // Compliance scope is captured as a unit: when any dimension is present in the
  // payload, persist the whole profile and stamp the capture time. Sanitize to
  // the supported jurisdiction slugs so a stray value can't poison corpus matching.
  const ALLOWED_JURISDICTIONS = new Set(["us", "eu", "uk", "global"]);
  const sanitizeJurisdictions = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((j): j is string => typeof j === "string" && ALLOWED_JURISDICTIONS.has(j)) : [];
  // Market-listing status gates listing-specific governance regimes (e.g. UK
  // Corporate Governance Code Provision 29). Sanitize to the LISTING_STATUSES
  // enum; an unknown/empty value clears it (null = undeclared → "review").
  const ALLOWED_LISTING_STATUSES = new Set([
    "premium-listed",
    "standard-listed",
    "aim-listed",
    "private",
    "other",
  ]);
  const sanitizeListingStatus = (v: unknown): string | null =>
    typeof v === "string" && ALLOWED_LISTING_STATUSES.has(v) ? v : null;
  // Data-handling predicates gate the horizontal regimes (privacy, AI, marketing,
  // accessibility, sector overlays). Filter to the closed DATA_HANDLING_PREDICATES
  // set so a stray value can't create a phantom trigger; dedupe.
  const sanitizeDataHandling = (v: unknown): string[] =>
    Array.isArray(v)
      ? [...new Set(v.filter((p): p is string => typeof p === "string" && isDataHandlingPredicate(p)))]
      : [];
  const complianceScopeProvided =
    operatesIn !== undefined ||
    sellsTo !== undefined ||
    employsIn !== undefined ||
    dataResidency !== undefined ||
    handlesCardPayments !== undefined ||
    dataHandling !== undefined ||
    listingStatus !== undefined;
  const complianceScope = complianceScopeProvided
    ? {
        operatesIn: sanitizeJurisdictions(operatesIn),
        sellsTo: sanitizeJurisdictions(sellsTo),
        employsIn: sanitizeJurisdictions(employsIn),
        dataResidency: sanitizeJurisdictions(dataResidency),
        handlesCardPayments: handlesCardPayments === true,
        dataHandling: sanitizeDataHandling(dataHandling),
        listingStatus: sanitizeListingStatus(listingStatus),
        complianceScopeCapturedAt: new Date(),
      }
    : {};

  // Risk posture: the form sends it only when the operator actually chose one
  // (an untouched industry-derived default is left for setup completion to seed),
  // so a present + valid value is an explicit operator choice. Reject unknown
  // values rather than poisoning the typed knob (EP-ONBOARDING-INTAKE P0).
  const riskPostureUpdate =
    riskPosture !== undefined && isRiskPosture(riskPosture)
      ? {
          riskPosture,
          riskPostureSource: "operator",
          riskPostureCapturedAt: new Date(),
        }
      : {};

  const org = await prisma.organization.findFirst({ select: { id: true, address: true } });
  if (!org) {
    return NextResponse.json(
      { error: "Organization not found. Complete account setup first." },
      { status: 400 },
    );
  }

  // Capture the canonical business address (Organization.address per AGENTS.md
  // S11). Merge non-destructively so any geocoding lat/lng survives; the US state
  // is mirrored into BusinessContext.stateCode below so the timezone derivation
  // and public-sector statutory defaults share one captured signal.
  const sanitizedAddress = address !== undefined ? sanitizeOrgAddressInput(address) : null;
  const addressJson = sanitizedAddress ? serializeOrgAddress(sanitizedAddress, org.address) : undefined;
  const addressStateCode = sanitizedAddress?.stateCode;

  // industry is derived from archetype.category; set only by /api/storefront/admin/setup
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      ...(contactEmail !== undefined && { email: contactEmail }),
      ...(contactPhone !== undefined && { phone: contactPhone }),
      ...(addressJson !== undefined && { address: addressJson as unknown as Prisma.InputJsonValue }),
    },
  });

  // Upsert BusinessContext — the canonical source of truth for business strategy
  const businessContext = await prisma.businessContext.upsert({
    where: { organizationId: org.id },
    create: {
      organizationId: org.id,
      description: description ?? null,
      mission: mission ?? null,
      targetMarket: targetMarket ?? null,
      sourceSystem: sourceSystem ?? null,
      companySize: companySize ?? null,
      geographicScope: geographicScope ?? null,
      revenueModel: revenueModel ?? null,
      customerSegments: [],
      ...(addressStateCode ? { stateCode: addressStateCode } : {}),
      ...complianceScope,
      ...riskPostureUpdate,
    },
    update: {
      ...(description !== undefined && { description }),
      ...(mission !== undefined && { mission }),
      ...(targetMarket !== undefined && { targetMarket }),
      ...(sourceSystem !== undefined && { sourceSystem }),
      ...(companySize !== undefined && { companySize }),
      ...(geographicScope !== undefined && { geographicScope }),
      ...(revenueModel !== undefined && { revenueModel }),
      ...(addressStateCode ? { stateCode: addressStateCode } : {}),
      ...complianceScope,
      ...riskPostureUpdate,
    },
  });

  // When the operator changes the posture, keep the org WWWD profile's autonomy
  // policy in sync (P1). Fail-open inside the helper; balanced = no change.
  if (Object.keys(riskPostureUpdate).length > 0) {
    await applyRiskEnvelopeToOrgProfile({ organizationId: org.id });
  }

  return NextResponse.json({ success: true, id: businessContext.id });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await prisma.organization.findFirst({
    select: { id: true, email: true, phone: true, address: true },
  });
  if (!org) {
    return NextResponse.json({ businessContext: null });
  }

  const bc = await prisma.businessContext.findUnique({
    where: { organizationId: org.id },
  });

  return NextResponse.json({
    businessContext: bc,
    contactEmail: org.email,
    contactPhone: org.phone,
    address: parseOrgAddress(org.address),
  });
}
