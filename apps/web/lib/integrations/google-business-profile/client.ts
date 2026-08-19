import { request, type Dispatcher } from "undici";

export interface GoogleBusinessAccountRecord {
  name?: string;
  accountName?: string;
  type?: string;
  role?: string;
  [key: string]: unknown;
}

export interface GoogleBusinessLocationRecord {
  name?: string;
  title?: string;
  storefrontAddress?: {
    locality?: string;
    administrativeArea?: string;
    postalCode?: string;
    regionCode?: string;
    [key: string]: unknown;
  };
  websiteUri?: string;
  phoneNumbers?: {
    primaryPhone?: string;
    additionalPhones?: string[];
    [key: string]: unknown;
  };
  regularHours?: {
    periods?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GoogleBusinessReviewRecord {
  reviewId?: string;
  starRating?: string;
  comment?: string;
  reviewer?: {
    displayName?: string;
    [key: string]: unknown;
  };
  createTime?: string;
  updateTime?: string;
  [key: string]: unknown;
}

export interface GoogleBusinessLocalPostRecord {
  name?: string;
  languageCode?: string;
  summary?: string;
  topicType?: string;
  state?: string;
  searchUrl?: string;
  createTime?: string;
  updateTime?: string;
  callToAction?: {
    actionType?: string;
    url?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GoogleBusinessMediaRecord {
  name?: string;
  mediaFormat?: string;
  locationAssociation?: {
    category?: string;
    priceListItemId?: string;
    [key: string]: unknown;
  };
  googleUrl?: string;
  thumbnailUrl?: string;
  createTime?: string;
  dimensions?: {
    widthPixels?: number;
    heightPixels?: number;
    [key: string]: unknown;
  };
  insights?: {
    viewCount?: string;
    [key: string]: unknown;
  };
  attribution?: {
    profileName?: string;
    profileUrl?: string;
    [key: string]: unknown;
  };
  description?: string;
  [key: string]: unknown;
}

export interface GoogleBusinessMediaPreview {
  items: GoogleBusinessMediaRecord[];
  totalMediaItemCount: number;
}

export interface GoogleBusinessProfileProbeResult {
  account: GoogleBusinessAccountRecord;
  location: GoogleBusinessLocationRecord;
  reviews: GoogleBusinessReviewRecord[];
  localPosts: GoogleBusinessLocalPostRecord[];
  media: GoogleBusinessMediaPreview;
}

interface GoogleBusinessProfileRequestParams {
  accessToken: string;
  accountId: string;
  locationId: string;
  dispatcher?: Dispatcher;
}

export class GoogleBusinessProfileApiError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, opts?: { statusCode?: number }) {
    super(message);
    this.name = "GoogleBusinessProfileApiError";
    this.statusCode = opts?.statusCode;
  }
}

export function resolveGoogleBusinessAccountManagementApiBaseUrl(): string {
  return (
    process.env.GOOGLE_BUSINESS_ACCOUNT_MANAGEMENT_API_BASE_URL ??
    "https://mybusinessaccountmanagement.googleapis.com"
  );
}

export function resolveGoogleBusinessInformationApiBaseUrl(): string {
  return (
    process.env.GOOGLE_BUSINESS_INFORMATION_API_BASE_URL ??
    "https://mybusinessbusinessinformation.googleapis.com"
  );
}

export function resolveGoogleBusinessProfileApiBaseUrl(): string {
  return process.env.GOOGLE_BUSINESS_PROFILE_API_BASE_URL ?? "https://mybusiness.googleapis.com";
}

export async function probeGoogleBusinessProfile(
  params: GoogleBusinessProfileRequestParams,
): Promise<GoogleBusinessProfileProbeResult> {
  const accounts = await listAccounts(params);
  const account = accounts.find((candidate) => candidate.name === `accounts/${params.accountId}`);

  if (!account) {
    throw new GoogleBusinessProfileApiError(
      `The supplied Google Business account ${params.accountId} is not accessible with these credentials.`,
    );
  }

  const [location, reviews, localPosts, media] = await Promise.all([
    getLocation(params),
    listReviews(params),
    listLocalPosts(params),
    listMedia(params),
  ]);

  return {
    account,
    location,
    reviews,
    localPosts,
    media,
  };
}

async function listAccounts(
  params: GoogleBusinessProfileRequestParams,
): Promise<GoogleBusinessAccountRecord[]> {
  const response = await fetchGoogleBusinessJson<{ accounts?: GoogleBusinessAccountRecord[] }>({
    url: `${resolveGoogleBusinessAccountManagementApiBaseUrl()}/v1/accounts`,
    accessToken: params.accessToken,
    dispatcher: params.dispatcher,
    unauthorizedMessage:
      "invalid Google Business Profile credentials or missing business.manage scope",
    unconfiguredMessage:
      "Google Business Profile API access has not been approved for this project, or the API is not enabled.",
  });

  return Array.isArray(response.accounts) ? response.accounts : [];
}

async function getLocation(
  params: GoogleBusinessProfileRequestParams,
): Promise<GoogleBusinessLocationRecord> {
  const query = new URLSearchParams({
    readMask: "name,title,storefrontAddress,websiteUri,phoneNumbers,regularHours,metadata",
  }).toString();

  return fetchGoogleBusinessJson<GoogleBusinessLocationRecord>({
    url: `${resolveGoogleBusinessInformationApiBaseUrl()}/v1/locations/${params.locationId}?${query}`,
    accessToken: params.accessToken,
    dispatcher: params.dispatcher,
    unauthorizedMessage:
      "invalid Google Business Profile location permissions for this account and location",
    unconfiguredMessage:
      "Google Business Profile Business Information API is not enabled or the location could not be read.",
  });
}

async function listReviews(
  params: GoogleBusinessProfileRequestParams,
): Promise<GoogleBusinessReviewRecord[]> {
  const query = new URLSearchParams({
    pageSize: "5",
  }).toString();

  const response = await fetchGoogleBusinessJson<{ reviews?: GoogleBusinessReviewRecord[] }>({
    url: `${resolveGoogleBusinessProfileApiBaseUrl()}/v4/accounts/${params.accountId}/locations/${params.locationId}/reviews?${query}`,
    accessToken: params.accessToken,
    dispatcher: params.dispatcher,
    unauthorizedMessage:
      "invalid Google Business Profile review permissions for this account and location",
    unconfiguredMessage:
      "Google Business Profile Reviews API is not enabled or the location reviews could not be read.",
  });

  return Array.isArray(response.reviews) ? response.reviews : [];
}

async function listLocalPosts(
  params: GoogleBusinessProfileRequestParams,
): Promise<GoogleBusinessLocalPostRecord[]> {
  const query = new URLSearchParams({
    pageSize: "5",
  }).toString();

  const response = await fetchGoogleBusinessJson<{ localPosts?: GoogleBusinessLocalPostRecord[] }>({
    url: `${resolveGoogleBusinessProfileApiBaseUrl()}/v4/accounts/${params.accountId}/locations/${params.locationId}/localPosts?${query}`,
    accessToken: params.accessToken,
    dispatcher: params.dispatcher,
    unauthorizedMessage:
      "invalid Google Business Profile local post permissions for this account and location",
    unconfiguredMessage:
      "Google Business Profile Local Posts API is not enabled or location posts could not be read.",
  });

  return Array.isArray(response.localPosts) ? response.localPosts : [];
}

async function listMedia(
  params: GoogleBusinessProfileRequestParams,
): Promise<GoogleBusinessMediaPreview> {
  const query = new URLSearchParams({
    pageSize: "6",
  }).toString();

  const response = await fetchGoogleBusinessJson<{
    mediaItems?: GoogleBusinessMediaRecord[];
    totalMediaItemCount?: number;
  }>({
    url: `${resolveGoogleBusinessProfileApiBaseUrl()}/v4/accounts/${params.accountId}/locations/${params.locationId}/media?${query}`,
    accessToken: params.accessToken,
    dispatcher: params.dispatcher,
    unauthorizedMessage:
      "invalid Google Business Profile media permissions for this account and location",
    unconfiguredMessage:
      "Google Business Profile Media API is not enabled or location media could not be read.",
  });

  return {
    items: Array.isArray(response.mediaItems) ? response.mediaItems : [],
    totalMediaItemCount:
      typeof response.totalMediaItemCount === "number" ? response.totalMediaItemCount : 0,
  };
}

async function fetchGoogleBusinessJson<T>({
  url,
  accessToken,
  dispatcher,
  unauthorizedMessage,
  unconfiguredMessage,
}: {
  url: string;
  accessToken: string;
  dispatcher?: Dispatcher;
  unauthorizedMessage: string;
  unconfiguredMessage: string;
}): Promise<T> {
  let response: Dispatcher.ResponseData;
  try {
    response = await request(url, {
      method: "GET",
      dispatcher,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new GoogleBusinessProfileApiError(
      "Google Business Profile API request failed — check network reachability and try again.",
    );
  }

  if (response.statusCode === 401 || response.statusCode === 403) {
    await safelyDrainBody(response.body);
    throw new GoogleBusinessProfileApiError(unauthorizedMessage, {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode === 404) {
    await safelyDrainBody(response.body);
    throw new GoogleBusinessProfileApiError("The requested Google Business location was not found.", {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode === 400 || response.statusCode === 429) {
    await safelyDrainBody(response.body);
    throw new GoogleBusinessProfileApiError(unconfiguredMessage, {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode >= 500) {
    await safelyDrainBody(response.body);
    throw new GoogleBusinessProfileApiError(
      "Google Business Profile returned a server error — retry later.",
      {
        statusCode: response.statusCode,
      },
    );
  }

  if (response.statusCode !== 200) {
    await safelyDrainBody(response.body);
    throw new GoogleBusinessProfileApiError(
      `Google Business Profile request failed with status ${response.statusCode}`,
      {
        statusCode: response.statusCode,
      },
    );
  }

  try {
    return await response.body.json() as T;
  } catch {
    throw new GoogleBusinessProfileApiError(
      "Google Business Profile response was not valid JSON",
      { statusCode: response.statusCode },
    );
  }
}

async function safelyDrainBody(body: { text: () => Promise<string> }): Promise<void> {
  try {
    await body.text();
  } catch {
    // ignore
  }
}
