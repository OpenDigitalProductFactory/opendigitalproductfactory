import { prisma } from "@dpf/db";
import { getFacebookLeadAdsAcquisitionSignal } from "@/lib/integrations/facebook-lead-ads/signal";
import {
  buildAcquisitionSignalWorkspace,
  type AcquisitionSignalInput,
  type AcquisitionSignalWorkspace,
} from "./acquisition-signals";

type ContactRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  accountId: string;
  account: {
    id: string;
    name: string;
  };
};

function compact<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((value): value is T => value !== null && value !== undefined);
}

function buildContactLabel(contact: ContactRow): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || contact.email;
}

export async function getAcquisitionSignalWorkspace(): Promise<AcquisitionSignalWorkspace> {
  const [inquiries, facebookSignal] = await Promise.all([
    prisma.storefrontInquiry.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        inquiryRef: true,
        customerContactId: true,
        customerEmail: true,
        customerName: true,
        customerPhone: true,
        message: true,
        status: true,
        createdAt: true,
      },
    }),
    getFacebookLeadAdsAcquisitionSignal(),
  ]);

  const contactIds = compact(inquiries.map((inquiry) => inquiry.customerContactId));
  const emails = inquiries.map((inquiry) => inquiry.customerEmail).filter(Boolean);
  const contactWhere =
    contactIds.length > 0 || emails.length > 0
      ? {
          OR: [
            ...(contactIds.length > 0 ? [{ id: { in: contactIds } }] : []),
            ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
          ],
        }
      : null;
  const contacts: ContactRow[] = contactWhere
    ? await prisma.customerContact.findMany({
        where: contactWhere,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          accountId: true,
          account: { select: { id: true, name: true } },
        },
      })
    : [];
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const contactsByEmail = new Map(contacts.map((contact) => [contact.email, contact]));
  const sourcePairs = [
    ...inquiries.map((inquiry) => ({ source: "web_inquiry", sourceRefId: inquiry.id })),
    ...(facebookSignal
      ? [{ source: facebookSignal.source, sourceRefId: facebookSignal.sourceRefId }]
      : []),
  ];
  const linkedEngagements =
    sourcePairs.length > 0
      ? await prisma.engagement.findMany({
          where: {
            OR: sourcePairs,
          },
          select: {
            id: true,
            title: true,
            status: true,
            source: true,
            sourceRefId: true,
          },
        })
      : [];
  const engagementBySourceRef = new Map(
    linkedEngagements.map((engagement) => [
      `${engagement.source ?? ""}:${engagement.sourceRefId ?? ""}`,
      engagement,
    ]),
  );

  const storefrontSignals: AcquisitionSignalInput[] = inquiries.map((inquiry) => {
    const contact =
      (inquiry.customerContactId ? contactsById.get(inquiry.customerContactId) : null) ??
      contactsByEmail.get(inquiry.customerEmail) ??
      null;
    const buyerLabel = inquiry.customerName || inquiry.customerEmail;
    const linkedEngagement = engagementBySourceRef.get(`web_inquiry:${inquiry.id}`) ?? null;

    return {
      id: inquiry.id,
      kind: "storefront_inquiry",
      source: "web_inquiry",
      sourceRefId: inquiry.id,
      observedAt: inquiry.createdAt,
      title: `Storefront inquiry from ${buyerLabel}`,
      summary: inquiry.message || `Storefront inquiry status: ${inquiry.status}`,
      buyerLabel,
      channelLabel: "Storefront inquiry",
      evidence: [
        `Ref ${inquiry.inquiryRef}`,
        inquiry.customerEmail,
        ...(inquiry.customerPhone ? [inquiry.customerPhone] : []),
        `Status ${inquiry.status}`,
      ],
      contact: contact
        ? {
            id: contact.id,
            accountId: contact.accountId,
            label: buildContactLabel(contact),
            email: contact.email,
            accountLabel: contact.account.name,
          }
        : null,
      accountLabel: contact?.account.name ?? null,
      linkedEngagement: linkedEngagement
        ? {
            id: linkedEngagement.id,
            title: linkedEngagement.title,
            status: linkedEngagement.status,
          }
        : null,
    };
  });

  const signals = [
    ...storefrontSignals,
    ...(facebookSignal
      ? [
          {
            ...facebookSignal,
            linkedEngagement:
              engagementBySourceRef.get(`${facebookSignal.source}:${facebookSignal.sourceRefId}`) ??
              null,
          },
        ]
      : []),
  ];

  return buildAcquisitionSignalWorkspace({ signals });
}
