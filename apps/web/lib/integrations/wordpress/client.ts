import { safeJsonRequest, type SafeJsonRequestInput, type SafeJsonResponse } from "@/lib/security/safe-request";

import type { WordPressCredential } from "./connector";
import type { WordPressReadRecord } from "./sync";

export type WordPressRequest = (input: SafeJsonRequestInput) => Promise<SafeJsonResponse<unknown>>;

export type WordPressErrorCode =
  | "authentication_failed"
  | "permission_denied"
  | "rest_unavailable"
  | "rate_limited"
  | "upstream_unavailable"
  | "request_failed"
  | "unsupported_response";

export class WordPressClientError extends Error {
  constructor(
    readonly code: WordPressErrorCode | string,
    message: string,
    readonly retryable = false,
    readonly ambiguous = false,
  ) {
    super(message);
    this.name = "WordPressClientError";
  }
}

export interface WordPressProbe {
  siteName: string;
  origin: string;
  authenticatedUser: { id: number; name: string };
  supportedResourceKinds: Array<"post" | "page" | "media">;
  canCreateDrafts: boolean;
  canPublishLive: boolean;
  canUploadMedia: boolean;
  supportedTaxonomies?: string[];
  unsupportedResourceTypes?: string[];
}

type UpsertInput = {
  resourceKind: "post" | "page" | "media";
  externalId: string | null;
  payload: Record<string, unknown> | Uint8Array;
  contentType?: string;
  fileName?: string;
};

type WordPressEntity = { id?: number; link?: string; modified_gmt?: string; [key: string]: unknown };

function endpoint(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/$/, "")}/wp-json${path}`;
}

function authorization(credential: WordPressCredential): string {
  return `Basic ${Buffer.from(`${credential.username}:${credential.applicationPassword}`).toString("base64")}`;
}

function classify(status: number): WordPressClientError | null {
  if (status === 401) return new WordPressClientError("authentication_failed", "WordPress rejected the Application Password.");
  if (status === 403) return new WordPressClientError("permission_denied", "The WordPress user lacks the required capability.");
  if (status === 404) return new WordPressClientError("rest_unavailable", "The WordPress REST API or resource is unavailable.");
  if (status === 429) return new WordPressClientError("rate_limited", "WordPress rate-limited the request.", true);
  if (status >= 500) return new WordPressClientError("upstream_unavailable", "WordPress returned a server error.", true);
  if (status < 200 || status >= 300) return new WordPressClientError("request_failed", `WordPress request failed with HTTP ${status}.`);
  return null;
}

export function createWordPressClient({
  credential,
  request = safeJsonRequest,
}: {
  credential: WordPressCredential;
  request?: WordPressRequest;
}) {
  const authHeaders = { authorization: authorization(credential) };

  async function json<T>(input: SafeJsonRequestInput): Promise<SafeJsonResponse<T>> {
    let response: SafeJsonResponse<T>;
    try {
      response = await request({ ...input, headers: { ...authHeaders, ...input.headers } }) as SafeJsonResponse<T>;
    } catch (error) {
      if (error instanceof WordPressClientError) throw error;
      const candidate = error as { code?: string; message?: string; retryable?: boolean; ambiguous?: boolean };
      throw new WordPressClientError(candidate.code ?? "request_failed", candidate.message ?? "WordPress request failed.", candidate.retryable ?? true, candidate.ambiguous ?? false);
    }
    const classified = classify(response.status);
    if (classified) throw classified;
    return response;
  }

  return {
    async probe(): Promise<WordPressProbe> {
      const root = await json<{ name?: string; url?: string }>({ url: endpoint(credential.siteUrl, "/") });
      const types = await json<unknown>({ url: endpoint(credential.siteUrl, "/wp/v2/types?context=edit") });
      const taxonomies = await json<unknown>({ url: endpoint(credential.siteUrl, "/wp/v2/taxonomies?context=edit") });
      const user = await json<{ id?: number; name?: string; capabilities?: Record<string, boolean> }>({ url: endpoint(credential.siteUrl, "/wp/v2/users/me?context=edit") });
      const typeValues = Array.isArray(types.data) ? types.data : Object.values(types.data && typeof types.data === "object" ? types.data : {});
      const slugs = new Set(typeValues.flatMap((value) => value && typeof value === "object" && "slug" in value ? [String(value.slug)] : []));
      const taxonomyValues = Array.isArray(taxonomies.data) ? taxonomies.data : Object.values(taxonomies.data && typeof taxonomies.data === "object" ? taxonomies.data : {});
      const taxonomySlugs = taxonomyValues.flatMap((value) => value && typeof value === "object" && "slug" in value ? [String(value.slug)] : []).slice(0, 20).sort();
      const capabilities = user.data.capabilities ?? {};
      if (typeof user.data.id !== "number") throw new WordPressClientError("unsupported_response", "WordPress did not return an authenticated user identity.");
      return {
        siteName: typeof root.data.name === "string" ? root.data.name.slice(0, 200) : new URL(credential.siteUrl).hostname,
        origin: new URL(credential.siteUrl).origin,
        authenticatedUser: { id: user.data.id, name: typeof user.data.name === "string" ? user.data.name.slice(0, 200) : "WordPress user" },
        supportedResourceKinds: [
          ...(slugs.has("post") ? ["post" as const] : []),
          ...(slugs.has("page") ? ["page" as const] : []),
          ...(capabilities.upload_files ? ["media" as const] : []),
        ],
        canCreateDrafts: Boolean(capabilities.edit_posts || capabilities.edit_pages),
        canPublishLive: Boolean(capabilities.publish_posts || capabilities.publish_pages),
        canUploadMedia: Boolean(capabilities.upload_files),
        supportedTaxonomies: taxonomySlugs,
        unsupportedResourceTypes: [...slugs].filter((slug) => slug !== "post" && slug !== "page" && slug !== "attachment").slice(0, 20).sort(),
      };
    },

    async list(resourceKind: "post" | "page" | "media", input: { page: number; pageSize: number; modifiedAfter?: string | null }): Promise<{ records: WordPressReadRecord[]; totalPages: number }> {
      const base = resourceKind === "post" ? "posts" : resourceKind === "page" ? "pages" : "media";
      const query = new URLSearchParams({ context: "edit", order: "asc", orderby: "modified", page: String(input.page), per_page: String(input.pageSize) });
      if (input.modifiedAfter) query.set("modified_after", `${input.modifiedAfter}Z`);
      const response = await json<WordPressEntity[]>({ url: endpoint(credential.siteUrl, `/wp/v2/${base}?${query}`) });
      const records = Array.isArray(response.data)
        ? response.data.filter((record): record is WordPressEntity & { id: number } => typeof record.id === "number")
        : [];
      const headerTotalPages = Number(response.headers.get("x-wp-totalpages") ?? 1);
      const totalPages = Number.isSafeInteger(headerTotalPages) && headerTotalPages > 0 ? headerTotalPages : 1;
      return { records, totalPages };
    },

    async upsertContent(input: UpsertInput): Promise<{ id: string; url: string | null; record: WordPressEntity }> {
      const base = input.resourceKind === "post" ? "posts" : input.resourceKind === "page" ? "pages" : "media";
      const suffix = input.externalId ? `/${encodeURIComponent(input.externalId)}` : "";
      const headers: Record<string, string> = {};
      const body = input.payload instanceof Uint8Array ? input.payload : JSON.stringify(input.payload);
      if (input.payload instanceof Uint8Array) {
        headers["content-type"] = input.contentType ?? "application/octet-stream";
        if (input.fileName) headers["content-disposition"] = `attachment; filename="${input.fileName.replace(/["\r\n]/g, "")}"`;
      } else headers["content-type"] = "application/json";
      const response = await json<WordPressEntity>({ url: endpoint(credential.siteUrl, `/wp/v2/${base}${suffix}`), method: "POST", headers, body, maxResponseBytes: 2_000_000 });
      if (typeof response.data.id !== "number") throw new WordPressClientError("unsupported_response", "WordPress did not return a resource id.");
      return { id: String(response.data.id), url: typeof response.data.link === "string" ? response.data.link : null, record: response.data };
    },

    async getContent(resourceKind: "post" | "page" | "media", externalId: string): Promise<{ record: WordPressEntity; modifiedAt: Date | null }> {
      const base = resourceKind === "post" ? "posts" : resourceKind === "page" ? "pages" : "media";
      const response = await json<WordPressEntity>({ url: endpoint(credential.siteUrl, `/wp/v2/${base}/${encodeURIComponent(externalId)}?context=edit`) });
      return {
        record: response.data,
        modifiedAt: typeof response.data.modified_gmt === "string" ? new Date(`${response.data.modified_gmt}Z`) : null,
      };
    },
  };
}
