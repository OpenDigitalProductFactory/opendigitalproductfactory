import type { Dispatcher } from "undici";
import {
  requestFacebookGraphJson,
  resolveFacebookGraphApiBaseUrl,
} from "../facebook/shared-client";

export interface WhatsAppBusinessPhoneNumber {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  codeVerificationStatus: string | null;
  platformType: string | null;
}

export interface WhatsAppBusinessTemplate {
  id: string;
  name: string;
  language: string | null;
  status: string | null;
  category: string | null;
  bodyText: string | null;
}

export interface WhatsAppBusinessLocaleSummary {
  language: string;
  approved: number;
  pending: number;
  rejected: number;
}

export interface WhatsAppBusinessProbeResult {
  phoneNumber: WhatsAppBusinessPhoneNumber;
  templates: WhatsAppBusinessTemplate[];
  localeSummary: WhatsAppBusinessLocaleSummary[];
}

interface WhatsAppBusinessRequestParams {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  dispatcher?: Dispatcher;
}

export class WhatsAppBusinessApiError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, opts?: { statusCode?: number }) {
    super(message);
    this.name = "WhatsAppBusinessApiError";
    this.statusCode = opts?.statusCode;
  }
}

export const resolveWhatsAppGraphApiBaseUrl = resolveFacebookGraphApiBaseUrl;

export async function probeWhatsAppBusiness(
  params: WhatsAppBusinessRequestParams,
): Promise<WhatsAppBusinessProbeResult> {
  const [phoneNumber, templates] = await Promise.all([
    getPhoneNumberReadiness(params),
    listMessageTemplates(params),
  ]);

  return {
    phoneNumber,
    templates,
    localeSummary: summarizeLocales(templates),
  };
}

async function getPhoneNumberReadiness(
  params: WhatsAppBusinessRequestParams,
): Promise<WhatsAppBusinessPhoneNumber> {
  const payload = await requestFacebookGraphJson<{
    data?: Array<{
      id?: string;
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
      code_verification_status?: string;
      platform_type?: string;
    }>;
  }, WhatsAppBusinessApiError>({
    path: `v21.0/${encodeURIComponent(params.wabaId)}/phone_numbers`,
    searchParams: new URLSearchParams({
      fields: "id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type",
      access_token: params.accessToken,
    }),
    dispatcher: params.dispatcher,
    surfaceLabel: "WhatsApp Business",
    invalidAccessMessage: "invalid WhatsApp Business access",
    createError: (message, opts) => new WhatsAppBusinessApiError(message, opts),
  });

  const phoneNumbers = Array.isArray(payload.data) ? payload.data : [];
  const match = phoneNumbers.find((phone) => phone.id === params.phoneNumberId);
  if (!match) {
    throw new WhatsAppBusinessApiError(
      "WhatsApp Business phone number ID was not found on the supplied WABA",
    );
  }

  return {
    id: params.phoneNumberId,
    displayPhoneNumber:
      typeof match.display_phone_number === "string" ? match.display_phone_number : null,
    verifiedName: typeof match.verified_name === "string" ? match.verified_name : null,
    qualityRating: typeof match.quality_rating === "string" ? match.quality_rating : null,
    codeVerificationStatus:
      typeof match.code_verification_status === "string" ? match.code_verification_status : null,
    platformType: typeof match.platform_type === "string" ? match.platform_type : null,
  };
}

async function listMessageTemplates(
  params: WhatsAppBusinessRequestParams,
): Promise<WhatsAppBusinessTemplate[]> {
  const payload = await requestFacebookGraphJson<{
    data?: Array<{
      id?: string;
      name?: string;
      language?: string;
      status?: string;
      category?: string;
      components?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  }, WhatsAppBusinessApiError>({
    path: `v21.0/${encodeURIComponent(params.wabaId)}/message_templates`,
    searchParams: new URLSearchParams({
      fields: "id,name,language,status,category,components",
      access_token: params.accessToken,
      limit: "25",
    }),
    dispatcher: params.dispatcher,
    surfaceLabel: "WhatsApp Business",
    invalidAccessMessage: "invalid WhatsApp Business access",
    createError: (message, opts) => new WhatsAppBusinessApiError(message, opts),
  });

  return Array.isArray(payload.data)
    ? payload.data
        .filter(
          (template): template is NonNullable<typeof template> & { id: string; name: string } =>
            typeof template?.id === "string" && typeof template.name === "string",
        )
        .map((template) => ({
          id: template.id,
          name: template.name,
          language: typeof template.language === "string" ? template.language : null,
          status: typeof template.status === "string" ? template.status : null,
          category: typeof template.category === "string" ? template.category : null,
          bodyText: findBodyText(template.components),
        }))
    : [];
}

function findBodyText(
  components: Array<{ type?: string; text?: string }> | undefined,
): string | null {
  const body = components?.find((component) => component.type === "BODY");
  return typeof body?.text === "string" ? body.text : null;
}

function summarizeLocales(
  templates: WhatsAppBusinessTemplate[],
): WhatsAppBusinessLocaleSummary[] {
  const byLanguage = new Map<string, WhatsAppBusinessLocaleSummary>();

  for (const template of templates) {
    const language = template.language ?? "unknown";
    const summary =
      byLanguage.get(language) ??
      {
        language,
        approved: 0,
        pending: 0,
        rejected: 0,
      };

    if (template.status === "APPROVED") summary.approved += 1;
    if (template.status === "PENDING") summary.pending += 1;
    if (template.status === "REJECTED") summary.rejected += 1;

    byLanguage.set(language, summary);
  }

  return Array.from(byLanguage.values()).sort((left, right) =>
    left.language.localeCompare(right.language),
  );
}
