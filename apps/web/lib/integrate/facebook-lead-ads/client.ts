import { request, type Dispatcher } from "undici";

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

export function resolveFacebookGraphApiBaseUrl(): string {
  return process.env.FACEBOOK_GRAPH_API_BASE_URL ?? "https://graph.facebook.com";
}

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
  const searchParams = new URLSearchParams({
    fields: "id,name,category",
    access_token: params.accessToken,
  });
  const url = `${resolveFacebookGraphApiBaseUrl()}/${encodeURIComponent(params.pageId)}?${searchParams.toString()}`;

  const response = await performRequest(url, params.dispatcher);
  const payload = (await response.body.json()) as {
    id?: string;
    name?: string;
    category?: string;
  };

  return {
    id: payload.id ?? params.pageId,
    name: typeof payload.name === "string" ? payload.name : null,
    category: typeof payload.category === "string" ? payload.category : null,
  };
}

async function listLeadForms(
  params: FacebookLeadAdsRequestParams,
): Promise<FacebookLeadAdsForm[]> {
  const searchParams = new URLSearchParams({
    fields: "id,name,status,locale,created_time",
    access_token: params.accessToken,
    limit: "5",
  });
  const url = `${resolveFacebookGraphApiBaseUrl()}/${encodeURIComponent(params.pageId)}/leadgen_forms?${searchParams.toString()}`;

  const response = await performRequest(url, params.dispatcher);
  const payload = (await response.body.json()) as {
    data?: Array<{
      id?: string;
      name?: string;
      status?: string;
      locale?: string;
      created_time?: string;
    }>;
  };

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
  const searchParams = new URLSearchParams({
    fields: "id,created_time,ad_id,form_id,field_data{name}",
    access_token: params.accessToken,
    limit: "5",
  });
  const url = `${resolveFacebookGraphApiBaseUrl()}/${encodeURIComponent(params.formId)}/leads?${searchParams.toString()}`;

  const response = await performRequest(url, params.dispatcher);
  const payload = (await response.body.json()) as {
    data?: Array<{
      id?: string;
      created_time?: string;
      ad_id?: string;
      form_id?: string;
      field_data?: Array<{
        name?: string;
      }>;
    }>;
  };

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

async function performRequest(url: string, dispatcher?: Dispatcher): Promise<Dispatcher.ResponseData> {
  let response: Dispatcher.ResponseData;
  try {
    response = await request(url, {
      method: "GET",
      dispatcher,
      headers: {
        accept: "application/json",
      },
    });
  } catch {
    throw new FacebookLeadAdsApiError(
      "Meta Lead Ads request failed — check network reachability and try again.",
    );
  }

  if (response.statusCode === 401 || response.statusCode === 403) {
    await safelyDrainBody(response.body);
    throw new FacebookLeadAdsApiError("invalid Meta page access", {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode !== 200) {
    await safelyDrainBody(response.body);
    throw new FacebookLeadAdsApiError(
      `Meta Lead Ads request failed with status ${response.statusCode}`,
      { statusCode: response.statusCode },
    );
  }

  return response;
}

function normalizeTimestamp(value: string | undefined): string | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

async function safelyDrainBody(body: { text: () => Promise<string> }): Promise<void> {
  try {
    await body.text();
  } catch {
    // ignore
  }
}
