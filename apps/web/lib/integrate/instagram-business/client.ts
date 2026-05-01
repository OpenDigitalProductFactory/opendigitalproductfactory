import type { Dispatcher } from "undici";
import {
  requestFacebookGraphJson,
  resolveFacebookGraphApiBaseUrl,
} from "../facebook/shared-client";

export interface InstagramBusinessProfile {
  id: string;
  username: string | null;
  name: string | null;
  biography: string | null;
  website: string | null;
  followersCount: number | null;
  followsCount: number | null;
  mediaCount: number | null;
  profilePictureUrl: string | null;
}

export interface InstagramBusinessMedia {
  id: string;
  caption: string | null;
  mediaType: string | null;
  mediaProductType: string | null;
  permalink: string | null;
  timestamp: string | null;
  likeCount: number | null;
  commentsCount: number | null;
}

export interface InstagramBusinessComment {
  id: string;
  text: string | null;
  username: string | null;
  timestamp: string | null;
}

export interface InstagramBusinessProbeResult {
  profile: InstagramBusinessProfile;
  recentMedia: InstagramBusinessMedia[];
  recentComments: InstagramBusinessComment[];
}

interface InstagramBusinessRequestParams {
  accessToken: string;
  instagramBusinessAccountId: string;
  dispatcher?: Dispatcher;
}

export class InstagramBusinessApiError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, opts?: { statusCode?: number }) {
    super(message);
    this.name = "InstagramBusinessApiError";
    this.statusCode = opts?.statusCode;
  }
}

export const resolveInstagramGraphApiBaseUrl = resolveFacebookGraphApiBaseUrl;

export async function probeInstagramBusiness(
  params: InstagramBusinessRequestParams,
): Promise<InstagramBusinessProbeResult> {
  const [profile, recentMedia] = await Promise.all([
    getProfile(params),
    listRecentMedia(params),
  ]);
  const recentComments =
    recentMedia.length > 0
      ? await listRecentComments({
          ...params,
          mediaId: recentMedia[0].id,
        })
      : [];

  return {
    profile,
    recentMedia,
    recentComments,
  };
}

async function getProfile(
  params: InstagramBusinessRequestParams,
): Promise<InstagramBusinessProfile> {
  const payload = await requestFacebookGraphJson<{
    id?: string;
    username?: string;
    name?: string;
    biography?: string;
    website?: string;
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
    profile_picture_url?: string;
  }, InstagramBusinessApiError>({
    path: `v21.0/${encodeURIComponent(params.instagramBusinessAccountId)}`,
    searchParams: new URLSearchParams({
      fields:
        "id,username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url",
      access_token: params.accessToken,
    }),
    dispatcher: params.dispatcher,
    surfaceLabel: "Instagram Business",
    invalidAccessMessage: "invalid Instagram Business access",
    createError: (message, opts) => new InstagramBusinessApiError(message, opts),
  });

  return {
    id: payload.id ?? params.instagramBusinessAccountId,
    username: typeof payload.username === "string" ? payload.username : null,
    name: typeof payload.name === "string" ? payload.name : null,
    biography: typeof payload.biography === "string" ? payload.biography : null,
    website: typeof payload.website === "string" ? payload.website : null,
    followersCount:
      typeof payload.followers_count === "number" ? payload.followers_count : null,
    followsCount: typeof payload.follows_count === "number" ? payload.follows_count : null,
    mediaCount: typeof payload.media_count === "number" ? payload.media_count : null,
    profilePictureUrl:
      typeof payload.profile_picture_url === "string" ? payload.profile_picture_url : null,
  };
}

async function listRecentMedia(
  params: InstagramBusinessRequestParams,
): Promise<InstagramBusinessMedia[]> {
  const payload = await requestFacebookGraphJson<{
    data?: Array<{
      id?: string;
      caption?: string;
      media_type?: string;
      media_product_type?: string;
      permalink?: string;
      timestamp?: string;
      like_count?: number;
      comments_count?: number;
    }>;
  }, InstagramBusinessApiError>({
    path: `v21.0/${encodeURIComponent(params.instagramBusinessAccountId)}/media`,
    searchParams: new URLSearchParams({
      fields:
        "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
      access_token: params.accessToken,
      limit: "5",
    }),
    dispatcher: params.dispatcher,
    surfaceLabel: "Instagram Business",
    invalidAccessMessage: "invalid Instagram Business access",
    createError: (message, opts) => new InstagramBusinessApiError(message, opts),
  });

  return Array.isArray(payload.data)
    ? payload.data
        .filter((media): media is NonNullable<typeof media> & { id: string } => typeof media?.id === "string")
        .map((media) => ({
          id: media.id,
          caption: typeof media.caption === "string" ? media.caption : null,
          mediaType: typeof media.media_type === "string" ? media.media_type : null,
          mediaProductType:
            typeof media.media_product_type === "string" ? media.media_product_type : null,
          permalink: typeof media.permalink === "string" ? media.permalink : null,
          timestamp: normalizeTimestamp(media.timestamp),
          likeCount: typeof media.like_count === "number" ? media.like_count : null,
          commentsCount:
            typeof media.comments_count === "number" ? media.comments_count : null,
        }))
    : [];
}

async function listRecentComments(
  params: InstagramBusinessRequestParams & { mediaId: string },
): Promise<InstagramBusinessComment[]> {
  const payload = await requestFacebookGraphJson<{
    data?: Array<{
      id?: string;
      text?: string;
      username?: string;
      timestamp?: string;
    }>;
  }, InstagramBusinessApiError>({
    path: `v21.0/${encodeURIComponent(params.mediaId)}/comments`,
    searchParams: new URLSearchParams({
      fields: "id,text,username,timestamp",
      access_token: params.accessToken,
      limit: "5",
    }),
    dispatcher: params.dispatcher,
    surfaceLabel: "Instagram Business",
    invalidAccessMessage: "invalid Instagram Business access",
    createError: (message, opts) => new InstagramBusinessApiError(message, opts),
  });

  return Array.isArray(payload.data)
    ? payload.data
        .filter((comment): comment is NonNullable<typeof comment> & { id: string } => typeof comment?.id === "string")
        .map((comment) => ({
          id: comment.id,
          text: typeof comment.text === "string" ? comment.text : null,
          username: typeof comment.username === "string" ? comment.username : null,
          timestamp: normalizeTimestamp(comment.timestamp),
        }))
    : [];
}

function normalizeTimestamp(value: string | undefined): string | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}
