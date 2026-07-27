"use server";

/**
 * Customer site create/update with validated address materialization
 * (BI-SITE-4F2C93 / EP-SITE-7C4D2B). Split from crm.ts for module-size ratchet.
 */

import { prisma } from "@dpf/db";
import { normalizeLocalityName } from "@dpf/db/location-normalize";
import crypto from "crypto";
import { revalidatePath } from "next/cache";
import {
  resolveValidatedSiteAddress,
  searchValidatedSiteAddresses,
  type ValidatedSiteAddress,
} from "@/lib/shared/site-address-validation";
import {
  checkCustomerSiteDuplicates,
  customerSiteNormalizedColumns,
  resolveDedupDecision,
  type DedupCheckResult,
  type DedupResolution,
} from "@/lib/mdm/dedup-gate";

async function logSystemActivity(
  subject: string,
  opts: { type?: string; body?: string; accountId?: string } = {},
) {
  await prisma.activity.create({
    data: {
      activityId: `ACT-${crypto.randomUUID()}`,
      type: opts.type || "system",
      subject,
      body: opts.body ?? null,
      accountId: opts.accountId ?? null,
      contactId: null,
      opportunityId: null,
      createdById: null,
    },
  });
}

export async function searchCustomerSiteAddresses(query: string) {
  return searchValidatedSiteAddresses(query);
}

type SiteAddressTx = {
  country: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
  region: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: unknown) => Promise<{ id: string }>;
  };
  city: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    create: (args: unknown) => Promise<{ id: string }>;
  };
  address: {
    create: (args: unknown) => Promise<{ id: string }>;
  };
};

async function materializeValidatedSiteAddress(
  tx: SiteAddressTx,
  validatedAddress: ValidatedSiteAddress,
): Promise<string> {
  const country = await tx.country.findFirst({
    where: {
      status: "active",
      OR: [
        { iso2: validatedAddress.countryCode },
        { name: validatedAddress.country },
      ],
    },
    select: { id: true },
  });

  if (!country) {
    throw new Error(
      `Country reference data is missing for ${validatedAddress.country}.`,
    );
  }

  let region = await tx.region.findFirst({
    where: {
      countryId: country.id,
      status: "active",
      OR: [
        ...(validatedAddress.regionCode
          ? [{ code: validatedAddress.regionCode }]
          : []),
        { name: validatedAddress.region },
      ],
    },
    select: { id: true },
  });

  if (!region) {
    region = await tx.region.create({
      data: {
        countryId: country.id,
        name: validatedAddress.region,
        code: validatedAddress.regionCode,
        status: "active",
      },
      select: { id: true },
    });
  }

  let city = await tx.city.findFirst({
    where: {
      regionId: region.id,
      status: "active",
      nameNormalized: normalizeLocalityName(validatedAddress.city),
    },
    select: { id: true },
  });

  if (!city) {
    city = await tx.city.create({
      data: {
        regionId: region.id,
        name: validatedAddress.city,
        nameNormalized: normalizeLocalityName(validatedAddress.city),
        source: "validated-address",
        sourceProvider: validatedAddress.validationSource,
        status: "active",
      },
      select: { id: true },
    });
  }

  const address = await tx.address.create({
    data: {
      label: "site",
      addressLine1: validatedAddress.addressLine1,
      addressLine2: validatedAddress.addressLine2,
      cityId: city.id,
      postalCode: validatedAddress.postalCode,
      latitude: validatedAddress.latitude,
      longitude: validatedAddress.longitude,
      validatedAt: new Date(),
      validationSource: validatedAddress.validationSource,
      status: "active",
    },
    select: { id: true },
  });

  return address.id;
}

export type CreateCustomerSiteResult =
  | { outcome: "created"; site: Awaited<ReturnType<typeof prisma.customerSite.create>> }
  | { outcome: "existing"; site: Awaited<ReturnType<typeof prisma.customerSite.create>> }
  | { outcome: "duplicates-found"; check: DedupCheckResult };

/** Gated create (EP-4A12A7CB WG-2). */
export async function createCustomerSite(
  input: {
    accountId: string;
    name: string;
    validatedAddressRef?: string;
    siteType?: string;
    status?: string;
    timezone?: string;
    accessInstructions?: string;
    hoursNotes?: string;
    serviceNotes?: string;
    primaryAddressId?: string;
  },
  dedup?: DedupResolution,
): Promise<CreateCustomerSiteResult> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Site name is required");
  }

  const check = await checkCustomerSiteDuplicates({ accountId: input.accountId, name });
  const decision = resolveDedupDecision(check, dedup);
  if (decision.action === "use-existing") {
    const existing = await prisma.customerSite.findUniqueOrThrow({
      where: { id: decision.existingId },
    });
    return { outcome: "existing", site: existing };
  }
  if (decision.action === "needs-resolution") {
    return { outcome: "duplicates-found", check };
  }

  if (!input.validatedAddressRef?.trim()) {
    throw new Error("A validated address selection is required");
  }

  const validatedAddress = await resolveValidatedSiteAddress(
    input.validatedAddressRef,
  );

  const site = await prisma.$transaction(async (tx) => {
    const addressId =
      input.primaryAddressId ||
      (await materializeValidatedSiteAddress(
        tx as unknown as SiteAddressTx,
        validatedAddress,
      ));

    return tx.customerSite.create({
      data: {
        siteId: `SITE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        accountId: input.accountId,
        name,
        ...customerSiteNormalizedColumns({ name }),
        siteType: input.siteType?.trim() || "office",
        status: input.status?.trim() || "active",
        timezone: input.timezone?.trim() || null,
        accessInstructions: input.accessInstructions?.trim() || null,
        hoursNotes: input.hoursNotes?.trim() || null,
        serviceNotes: input.serviceNotes?.trim() || null,
        primaryAddressId: addressId,
      },
    });
  });

  await logSystemActivity(`Customer site "${site.name}" created`, {
    type: "account_created",
    accountId: input.accountId,
  });

  revalidatePath("/customer");
  revalidatePath(`/customer/${input.accountId}`);
  return { outcome: "created", site };
}

/** Update site; optional validatedAddressRef refreshes primary address + coords. */
export async function updateCustomerSite(input: {
  id: string;
  accountId: string;
  name?: string;
  siteType?: string;
  status?: string;
  timezone?: string;
  accessInstructions?: string;
  hoursNotes?: string;
  serviceNotes?: string;
  validatedAddressRef?: string;
}) {
  const existing = await prisma.customerSite.findFirst({
    where: { id: input.id, accountId: input.accountId },
    select: {
      id: true,
      name: true,
      siteType: true,
      status: true,
      timezone: true,
      accessInstructions: true,
      hoursNotes: true,
      serviceNotes: true,
      primaryAddressId: true,
    },
  });

  if (!existing) {
    throw new Error("Customer site not found");
  }

  const nextName =
    input.name !== undefined ? input.name.trim() : existing.name;
  if (!nextName) {
    throw new Error("Site name is required");
  }

  let validatedAddress: ValidatedSiteAddress | null = null;
  if (input.validatedAddressRef?.trim()) {
    validatedAddress = await resolveValidatedSiteAddress(input.validatedAddressRef);
  } else if (!existing.primaryAddressId) {
    throw new Error(
      "A validated address selection is required when the site has no address yet.",
    );
  }

  const site = await prisma.$transaction(async (tx) => {
    let primaryAddressId = existing.primaryAddressId;
    if (validatedAddress) {
      primaryAddressId = await materializeValidatedSiteAddress(
        tx as unknown as SiteAddressTx,
        validatedAddress,
      );
    }

    return tx.customerSite.update({
      where: { id: existing.id },
      data: {
        name: nextName,
        ...customerSiteNormalizedColumns({ name: nextName }),
        siteType:
          input.siteType !== undefined
            ? input.siteType.trim() || "office"
            : existing.siteType,
        status:
          input.status !== undefined
            ? input.status.trim() || "active"
            : existing.status,
        timezone:
          input.timezone !== undefined
            ? input.timezone.trim() || null
            : existing.timezone,
        accessInstructions:
          input.accessInstructions !== undefined
            ? input.accessInstructions.trim() || null
            : existing.accessInstructions,
        hoursNotes:
          input.hoursNotes !== undefined
            ? input.hoursNotes.trim() || null
            : existing.hoursNotes,
        serviceNotes:
          input.serviceNotes !== undefined
            ? input.serviceNotes.trim() || null
            : existing.serviceNotes,
        primaryAddressId,
      },
    });
  });

  await logSystemActivity(`Customer site "${site.name}" updated`, {
    type: "account_created",
    accountId: input.accountId,
  });

  revalidatePath("/customer");
  revalidatePath(`/customer/${input.accountId}`);
  return site;
}
