import type { Dispatcher } from "undici";
import {
  requestFacebookGraphJson,
  resolveFacebookGraphApiBaseUrl,
} from "../facebook/shared-client";

export interface FacebookPagesPage {
  id: string;
  name: string | null;
  category: string | null;
  link: string | null;
  fanCount: number | null;
}

export interface FacebookPagesPost {
  id: string;
  message: string | null;
  createdTime: string | null;
  permalinkUrl: string | null;
}

export interface FacebookPagesComment {
  id: string;
  message: string | null;
  createdTime: string | null;
  fromName: string | null;
}

export interface FacebookPagesProbeResult {
  page: FacebookPagesPage;
  recentPosts: FacebookPagesPost[];
  recentComments: FacebookPagesComment[];
}

interface FacebookPagesRequestParams {
  accessToken: string;
  pageId: string;
  dispatcher?: Dispatcher;
}

export class FacebookPagesApiError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, opts?: { statusCode?: number }) {
    super(message);
    this.name = "FacebookPagesApiError";
    this.statusCode = opts?.statusCode;
  }
}

export { resolveFacebookGraphApiBaseUrl };

export async function probeFacebookPages(
  params: FacebookPagesRequestParams,
): Promise<FacebookPagesProbeResult> {
  const page = await getPageDetails(params);
  const recentPosts = await listRecentPosts(params);
  const recentComments =
    recentPosts.length > 0
      ? await listRecentComments({
        ...params,
        postId: recentPosts[0].id,
      })
      : [];

  return {
    page,
    recentPosts,
    recentComments,
  };
}

async function getPageDetails(
  params: FacebookPagesRequestParams,
): Promise<FacebookPagesPage> {
  const payload = await requestFacebookGraphJson<{
    id?: string;
    name?: string;
    category?: string;
    link?: string;
    fan_count?: number;
  }, FacebookPagesApiError>({
    path: encodeURIComponent(params.pageId),
    searchParams: new URLSearchParams({
      fields: "id,name,category,link,fan_count",
      access_token: params.accessToken,
    }),
    dispatcher: params.dispatcher,
    surfaceLabel: "Facebook Pages",
    invalidAccessMessage: "invalid Meta page access",
    createError: (message, opts) => new FacebookPagesApiError(message, opts),
  });

  return {
    id: payload.id ?? params.pageId,
    name: typeof payload.name === "string" ? payload.name : null,
    category: typeof payload.category === "string" ? payload.category : null,
    link: typeof payload.link === "string" ? payload.link : null,
    fanCount: typeof payload.fan_count === "number" ? payload.fan_count : null,
  };
}

async function listRecentPosts(
  params: FacebookPagesRequestParams,
): Promise<FacebookPagesPost[]> {
  const payload = await requestFacebookGraphJson<{
    data?: Array<{
      id?: string;
      message?: string;
      created_time?: string;
      permalink_url?: string;
    }>;
  }, FacebookPagesApiError>({
    path: `${encodeURIComponent(params.pageId)}/posts`,
    searchParams: new URLSearchParams({
      fields: "id,message,created_time,permalink_url",
      access_token: params.accessToken,
      limit: "5",
    }),
    dispatcher: params.dispatcher,
    surfaceLabel: "Facebook Pages",
    invalidAccessMessage: "invalid Meta page access",
    createError: (message, opts) => new FacebookPagesApiError(message, opts),
  });

  return Array.isArray(payload.data)
    ? payload.data
        .filter((post): post is NonNullable<typeof post> & { id: string } => typeof post?.id === "string")
        .map((post) => ({
          id: post.id,
          message: typeof post.message === "string" ? post.message : null,
          createdTime: normalizeTimestamp(post.created_time),
          permalinkUrl: typeof post.permalink_url === "string" ? post.permalink_url : null,
        }))
    : [];
}

async function listRecentComments(
  params: FacebookPagesRequestParams & { postId: string },
): Promise<FacebookPagesComment[]> {
  const payload = await requestFacebookGraphJson<{
    data?: Array<{
      id?: string;
      message?: string;
      created_time?: string;
      from?: {
        name?: string;
      };
    }>;
  }, FacebookPagesApiError>({
    path: `${encodeURIComponent(params.postId)}/comments`,
    searchParams: new URLSearchParams({
      fields: "id,message,created_time,from",
      access_token: params.accessToken,
      limit: "5",
    }),
    dispatcher: params.dispatcher,
    surfaceLabel: "Facebook Pages",
    invalidAccessMessage: "invalid Meta page access",
    createError: (message, opts) => new FacebookPagesApiError(message, opts),
  });

  return Array.isArray(payload.data)
    ? payload.data
        .filter((comment): comment is NonNullable<typeof comment> & { id: string } => typeof comment?.id === "string")
        .map((comment) => ({
          id: comment.id,
          message: typeof comment.message === "string" ? comment.message : null,
          createdTime: normalizeTimestamp(comment.created_time),
          fromName:
            comment.from && typeof comment.from.name === "string" ? comment.from.name : null,
        }))
    : [];
}

function normalizeTimestamp(value: string | undefined): string | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}
