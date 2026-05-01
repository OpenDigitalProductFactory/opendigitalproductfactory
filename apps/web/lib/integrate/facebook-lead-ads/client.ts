import type { Dispatcher } from "undici";
import {
  requestFacebookGraphJson,
  resolveFacebookGraphApiBaseUrl,
} from "../facebook/shared-client";

export interface FacebookLeadAdsPage {
  id: string;
  name: string | null;
  category: string | null;
}

export interface FacebookLeadAdsForm {
  id: string;
  name: string | null;
  status: string | null;
  locale: string | null;
  createdTime: string | null;
}

export interface FacebookLeadAdsLead {
  id: string;
  createdTime: string | null;
  adId: string | null;
  formId: string | null;
  fieldNames: string[];
}

export interface FacebookLeadAdsProbeResult {
  page: FacebookLeadAdsPage;
  forms: FacebookLeadAdsForm[];
  recentLeads: FacebookLeadAdsLead[];
}

interface FacebookLeadAdsRequestParams {
  accessToken: string;
  pageId: string;
  dispatcher?: Dispatcher;
}

export class FacebookLeadAdsApiError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, opts?: { statusCode?: number }) {
    super(message);
    this.name = "FacebookLeadAdsApiError";
    this.statusCode = opts?.statusCode;
  }
}

export { resolveFacebookGraphApiBaseUrl };

export async function probeFacebookLeadAds(
  params: FacebookLeadAdsRequestParams,
): Promise<FacebookLeadAdsProbeResult> {
  const page = await getPageDetails(params);
  const forms = await listLeadForms(params);
  const recentLeads =
    forms.length > 0 ? await listRecentLeads({ ...params, formId: forms[0].id }) : [];

  return {
    page,
    forms,
    recentLeads,
  };
}

async function getPageDetails(
  params: FacebookLeadAdsRequestParams,
): Promise<FacebookLeadAdsPage> {
  const payload = await requestFacebookGraphJson<{
    id?: string;
    name?: string;
    category?: string;
  }, FacebookLeadAdsApiError>({
    path: encodeURIComponent(params.pageId),
    searchParams: new URLSearchParams({
      fields: "id,name,category",
      access_token: params.accessToken,
    }),
    dispatcher: params.dispatcher,
    surfaceLabel: "Lead Ads",
    invalidAccessMessage: "invalid Meta page access",
    createError: (message, opts) => new FacebookLeadAdsApiError(message, opts),
  });

  return {
    id: payload.id ?? params.pageId,
    name: typeof payload.name === "string" ? payload.name : null,
    category: typeof payload.category === "string" ? payload.category : null,
  };
}

async function listLeadForms(
  params: FacebookLeadAdsRequestParams,
): Promise<FacebookLeadAdsForm[]> {
  const payload = await requestFacebookGraphJson<{
    data?: Array<{
      id?: string;
      name?: string;
      status?: string;
      locale?: string;
      created_time?: string;
    }>;
  }, FacebookLeadAdsApiError>({
    path: `${encodeURIComponent(params.pageId)}/leadgen_forms`,
    searchParams: new URLSearchParams({
      fields: "id,name,status,locale,created_time",
      access_token: params.accessToken,
      limit: "5",
    }),
    dispatcher: params.dispatcher,
    surfaceLabel: "Lead Ads",
    invalidAccessMessage: "invalid Meta page access",
    createError: (message, opts) => new FacebookLeadAdsApiError(message, opts),
  });

  return Array.isArray(payload.data)
    ? payload.data
        .filter((form): form is NonNullable<typeof form> & { id: string } => typeof form?.id === "string")
        .map((form) => ({
          id: form.id,
          name: typeof form.name === "string" ? form.name : null,
          status: typeof form.status === "string" ? form.status : null,
          locale: typeof form.locale === "string" ? form.locale : null,
          createdTime: normalizeTimestamp(form.created_time),
        }))
    : [];
}

async function listRecentLeads(
  params: FacebookLeadAdsRequestParams & { formId: string },
): Promise<FacebookLeadAdsLead[]> {
  const payload = await requestFacebookGraphJson<{
    data?: Array<{
      id?: string;
      created_time?: string;
      ad_id?: string;
      form_id?: string;
      field_data?: Array<{
        name?: string;
      }>;
    }>;
  }, FacebookLeadAdsApiError>({
    path: `${encodeURIComponent(params.formId)}/leads`,
    searchParams: new URLSearchParams({
      fields: "id,created_time,ad_id,form_id,field_data{name}",
      access_token: params.accessToken,
      limit: "5",
    }),
    dispatcher: params.dispatcher,
    surfaceLabel: "Lead Ads",
    invalidAccessMessage: "invalid Meta page access",
    createError: (message, opts) => new FacebookLeadAdsApiError(message, opts),
  });

  return Array.isArray(payload.data)
    ? payload.data
        .filter((lead): lead is NonNullable<typeof lead> & { id: string } => typeof lead?.id === "string")
        .map((lead) => ({
          id: lead.id,
          createdTime: normalizeTimestamp(lead.created_time),
          adId: typeof lead.ad_id === "string" ? lead.ad_id : null,
          formId: typeof lead.form_id === "string" ? lead.form_id : null,
          fieldNames: Array.isArray(lead.field_data)
            ? lead.field_data
                .map((field) => (typeof field?.name === "string" ? field.name : null))
                .filter((value): value is string => Boolean(value))
            : [],
        }))
    : [];
}

function normalizeTimestamp(value: string | undefined): string | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}
