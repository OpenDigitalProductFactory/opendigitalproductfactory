import { request, type Dispatcher } from "undici";

export interface MailchimpAccountSummary {
  accountName?: string;
  loginName?: string;
  email?: string;
  role?: string;
}

export interface MailchimpAudienceRecord {
  id?: string;
  name?: string;
  stats?: {
    member_count?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface MailchimpCampaignRecord {
  id?: string;
  status?: string;
  settings?: {
    title?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface MailchimpProbeResult {
  account: MailchimpAccountSummary;
  audiences: MailchimpAudienceRecord[];
  campaigns: MailchimpCampaignRecord[];
}

interface MailchimpRequestParams {
  apiKey: string;
  serverPrefix: string;
  dispatcher?: Dispatcher;
}

export class MailchimpApiError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, opts?: { statusCode?: number }) {
    super(message);
    this.name = "MailchimpApiError";
    this.statusCode = opts?.statusCode;
  }
}

export function resolveMailchimpApiBaseUrl(serverPrefix: string): string {
  return process.env.MAILCHIMP_API_BASE_URL ?? `https://${serverPrefix}.api.mailchimp.com`;
}

export async function probeMailchimpAccount(
  params: MailchimpRequestParams,
): Promise<MailchimpProbeResult> {
  const [account, audiences, campaigns] = await Promise.all([
    fetchMailchimpJson<{
      account_name?: string;
      login_name?: string;
      email?: string;
      role?: string;
    }>("/3.0/", params),
    fetchMailchimpJson<{ lists?: MailchimpAudienceRecord[] }>("/3.0/lists?count=5", params),
    fetchMailchimpJson<{ campaigns?: MailchimpCampaignRecord[] }>(
      "/3.0/campaigns?count=5",
      params,
    ),
  ]);

  return {
    account: {
      accountName: account.account_name,
      loginName: account.login_name,
      email: account.email,
      role: account.role,
    },
    audiences: Array.isArray(audiences.lists) ? audiences.lists : [],
    campaigns: Array.isArray(campaigns.campaigns) ? campaigns.campaigns : [],
  };
}

async function fetchMailchimpJson<T>(
  path: string,
  params: MailchimpRequestParams,
): Promise<T> {
  let response: Dispatcher.ResponseData;
  try {
    response = await request(`${resolveMailchimpApiBaseUrl(params.serverPrefix)}${path}`, {
      method: "GET",
      dispatcher: params.dispatcher,
      headers: {
        accept: "application/json",
        authorization: `Basic ${Buffer.from(`dpf:${params.apiKey}`).toString("base64")}`,
      },
    });
  } catch {
    throw new MailchimpApiError(
      "Mailchimp API request failed — check network reachability and try again.",
    );
  }

  if (response.statusCode === 401 || response.statusCode === 403) {
    await safelyDrainBody(response.body);
    throw new MailchimpApiError("invalid Mailchimp credentials", {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode >= 500) {
    await safelyDrainBody(response.body);
    throw new MailchimpApiError("Mailchimp API returned a server error — retry later.", {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode !== 200) {
    await safelyDrainBody(response.body);
    throw new MailchimpApiError(
      `Mailchimp API request failed with status ${response.statusCode}`,
      { statusCode: response.statusCode },
    );
  }

  try {
    return (await response.body.json()) as T;
  } catch {
    throw new MailchimpApiError("Mailchimp API response was not valid JSON", {
      statusCode: response.statusCode,
    });
  }
}

async function safelyDrainBody(body: { text: () => Promise<string> }): Promise<void> {
  try {
    await body.text();
  } catch {
    // ignore cleanup errors
  }
}
