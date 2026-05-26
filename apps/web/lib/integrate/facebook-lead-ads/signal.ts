import { prisma } from "@dpf/db";
import { decryptJson } from "@/lib/govern/credential-crypto";
import type { AcquisitionSignalInput } from "@/lib/crm/acquisition-signals";

const INTEGRATION_ID = "facebook-lead-ads";
const INTEGRATION_HREF = "/platform/tools/integrations/facebook-lead-ads";

type StoredFacebookLeadAdsFields = {
  pageId?: string;
  pageName?: string;
  pageCategory?: string;
};

export async function getFacebookLeadAdsAcquisitionSignal(): Promise<AcquisitionSignalInput | null> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });

  if (!record?.fieldsEnc || record.status !== "connected") {
    return null;
  }

  const fields = decryptJson<StoredFacebookLeadAdsFields>(record.fieldsEnc);
  if (typeof fields?.pageId !== "string" || fields.pageId.length === 0) {
    return null;
  }

  const pageLabel =
    typeof fields.pageName === "string" && fields.pageName.length > 0
      ? fields.pageName
      : `Page ${fields.pageId}`;
  const observedAt = record.lastTestedAt ?? record.updatedAt;
  const evidence = [
    `Page ${fields.pageId}`,
    record.lastTestedAt ? `Last tested ${formatDateLabel(record.lastTestedAt)}` : "Connection stored",
  ];

  if (typeof fields.pageCategory === "string" && fields.pageCategory.length > 0) {
    evidence.push(fields.pageCategory);
  }

  return {
    id: `${INTEGRATION_ID}:${fields.pageId}`,
    kind: "facebook_lead_ads",
    source: "facebook_lead_ads",
    sourceRefId: fields.pageId,
    observedAt,
    title: `Facebook Lead Ads connected for ${pageLabel}`,
    summary:
      "Read-first lead form context is available. Route a specific lead only after contact evidence is confirmed.",
    buyerLabel: pageLabel,
    channelLabel: "Facebook Lead Ads",
    evidence,
    integrationHref: INTEGRATION_HREF,
  };
}

function formatDateLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}
