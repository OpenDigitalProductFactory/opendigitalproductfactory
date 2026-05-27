// LinkedIn personal social — thin HTTP client.
//
// Covers the two endpoints Phase 2 needs:
//   GET  /v2/userinfo   → discover member URN (urn:li:person:{sub})
//   POST /v2/ugcPosts   → submit a UGC text post
//
// Designed for mockable testability — the real fetch is injected via the
// `fetchImpl` parameter so adapter tests can pass a typed mock without
// monkey-patching global state.

export const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
export const LINKEDIN_UGC_POSTS_URL = "https://api.linkedin.com/v2/ugcPosts";
export const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
export const LINKEDIN_AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";

/**
 * Scopes we request. `openid profile email` is the OpenID Connect trio for
 * `/v2/userinfo`; `w_member_social` is the only write scope needed for
 * publishing to the member's own feed. We never request company-page,
 * ads, or analytics scopes in Phase 2.
 */
export const LINKEDIN_REQUIRED_SCOPES = [
  "openid",
  "profile",
  "email",
  "w_member_social",
] as const;

export type LinkedInUserInfo = {
  sub: string;
  name?: string;
  email?: string;
  given_name?: string;
  family_name?: string;
};

export type LinkedInPublishResult =
  | { ok: true; id: string }
  | { ok: false; status: number; error: string; retryable: boolean };

export type FetchImpl = (
  url: string,
  init: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

const defaultFetch: FetchImpl = (url, init) => fetch(url, init) as ReturnType<FetchImpl>;

export async function fetchUserInfo(
  accessToken: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<LinkedInUserInfo | { error: string; status: number }> {
  const res = await fetchImpl(LINKEDIN_USERINFO_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    return { error: `userinfo_${res.status}`, status: res.status };
  }
  return (await res.json()) as LinkedInUserInfo;
}

export type UgcPostInput = {
  memberUrn: string;       // "urn:li:person:{sub}"
  body: string;            // plain text or pre-formatted text
  visibility?: "PUBLIC" | "CONNECTIONS";
};

export async function publishUgcPost(
  accessToken: string,
  input: UgcPostInput,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<LinkedInPublishResult> {
  const payload = {
    author: input.memberUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: input.body },
        shareMediaCategory: "NONE",
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": input.visibility ?? "PUBLIC",
    },
  };

  const res = await fetchImpl(LINKEDIN_UGC_POSTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    const json = (await res.json()) as { id?: string };
    if (!json.id) {
      return { ok: false, status: 200, error: "no_post_id_in_response", retryable: false };
    }
    return { ok: true, id: json.id };
  }

  const text = await res.text().catch(() => "");
  const retryable = res.status === 429 || res.status >= 500;
  const errorTag =
    res.status === 401 ? "linkedin_auth_failed"
    : res.status === 403 ? "linkedin_insufficient_scope"
    : res.status === 429 ? "linkedin_rate_limited"
    : `linkedin_http_${res.status}`;
  return { ok: false, status: res.status, error: `${errorTag}: ${text.slice(0, 200)}`, retryable };
}

export function memberUrnFromSub(sub: string): string {
  return `urn:li:person:${sub}`;
}

export function postUrlFromId(id: string): string {
  // id is "urn:li:share:1234..." or "urn:li:ugcPost:1234...".
  // LinkedIn permalink works from the URN tail.
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/`;
}

export type LinkedInTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_token_expires_in?: number;
  scope?: string;
  id_token?: string;
};

export async function exchangeCodeForToken(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: FetchImpl;
}): Promise<LinkedInTokenResponse | { error: string; status: number }> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });
  const fetchImpl = input.fetchImpl ?? defaultFetch;
  const res = await fetchImpl(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    return { error: `token_exchange_${res.status}`, status: res.status };
  }
  return (await res.json()) as LinkedInTokenResponse;
}

export function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: ReadonlyArray<string>;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
    scope: (input.scopes ?? LINKEDIN_REQUIRED_SCOPES).join(" "),
  });
  return `${LINKEDIN_AUTHORIZE_URL}?${params.toString()}`;
}
