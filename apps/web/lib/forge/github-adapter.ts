import { assertSafeOutboundUrl } from "@/lib/security/safe-fetch";
import type {
  CreateIssueInput,
  ForgeCapabilities,
  ForgeFailure,
  ForgeRepository,
  RemoteIssueResult,
} from "./types";

export type {
  CreateIssueInput,
  EgressClass,
  ForgeCapabilities,
  ForgeFailure,
  ForgeRepository,
  RemoteIssue,
  RemoteIssueResult,
} from "./types";

const GITHUB_API_HOST = "api.github.com";
const GITHUB_REPO_HOST = "github.com";

const RETRYABLE_NETWORK_PATTERNS = [
  "abort",
  "certificate",
  "connection reset",
  "dns",
  "connection refused",
  "econnreset",
  "econnrefused",
  "eof",
  "etimedout",
  "network",
  "socket",
  "tls",
  "timeout",
];

function trimGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

function repoFromParts(owner: string | undefined, repo: string | undefined): ForgeRepository | null {
  if (!owner || !repo) return null;
  const cleanRepo = trimGitSuffix(repo);
  if (!cleanRepo || owner.includes("/") || cleanRepo.includes("/")) return null;
  return { forge: "github", owner, repo: cleanRepo };
}

export function parseGitHubRepositoryUrl(url: string | null | undefined): ForgeRepository | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const scpLike = trimmed.match(/^git@github\.com:([^/]+)\/([^/?#]+?)(?:\.git)?(?:[?#].*)?$/i);
  if (scpLike) return repoFromParts(scpLike[1], scpLike[2]);

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.toLowerCase() !== GITHUB_REPO_HOST) return null;
    const [owner, repo] = parsed.pathname.replace(/^\/+/, "").split("/");
    return repoFromParts(owner, repo);
  } catch {
    return null;
  }
}

function messageFromFailure(input: unknown): string {
  if (input instanceof Error) return input.message;
  if (typeof input === "string") return input;
  return "GitHub operation failed";
}

function isResponseLike(input: unknown): input is Pick<Response, "status" | "headers"> {
  return (
    !!input &&
    typeof input === "object" &&
    "status" in input &&
    typeof input.status === "number"
  );
}

function retryAfterSeconds(response: Partial<Pick<Response, "headers">>): number | undefined {
  if (!response.headers || typeof response.headers.get !== "function") return undefined;
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bodyMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    return body.message;
  }
  return fallback;
}

export function classifyGitHubFailure(input: unknown, body?: unknown): ForgeFailure {
  if (isResponseLike(input)) {
    const message = bodyMessage(body, `GitHub returned status ${input.status}`);
    if (input.status === 401 || input.status === 403) {
      return {
        ok: false,
        adapter: "github",
        category: "unauthorized",
        retryable: false,
        freshness: "unavailable",
        status: input.status,
        message,
      };
    }
    if (input.status === 404) {
      return {
        ok: false,
        adapter: "github",
        category: "not-found",
        retryable: false,
        freshness: "unavailable",
        status: input.status,
        message,
      };
    }
    if (input.status === 409) {
      return {
        ok: false,
        adapter: "github",
        category: "conflict",
        retryable: false,
        freshness: "conflicted",
        status: input.status,
        message,
      };
    }
    if (input.status === 422) {
      return {
        ok: false,
        adapter: "github",
        category: "policy-rejected",
        retryable: false,
        freshness: "current",
        status: input.status,
        message,
      };
    }
    if (input.status === 429 || input.status >= 500) {
      return {
        ok: false,
        adapter: "github",
        category: "retryable",
        retryable: true,
        freshness: "unavailable",
        status: input.status,
        retryAfterSeconds: retryAfterSeconds(input),
        message,
      };
    }
    return {
      ok: false,
      adapter: "github",
      category: "invalid-response",
      retryable: false,
      freshness: "unavailable",
      status: input.status,
      message,
    };
  }

  const message = messageFromFailure(input);
  const lower = message.toLowerCase();
  const retryable = RETRYABLE_NETWORK_PATTERNS.some((pattern) => lower.includes(pattern));
  return {
    ok: false,
    adapter: "github",
    category: retryable ? "retryable" : "invalid-response",
    retryable,
    freshness: "unavailable",
    message,
  };
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

interface GitHubIssueResponse {
  number?: number;
  html_url?: string;
  message?: string;
}

export class GitHubForgeAdapter {
  constructor(private readonly config: { token: string }) {}

  capabilities(): ForgeCapabilities {
    return {
      adapter: "github",
      integrationAuthority: "external-forge-adapter",
      supportedEgressClasses: ["own-repo", "public-hive", "release-distribution"],
      supports: {
        branches: true,
        changeRequests: true,
        checks: true,
        issues: true,
        releases: true,
      },
    };
  }

  async createIssue(input: CreateIssueInput): Promise<RemoteIssueResult> {
    const pathOwner = encodeURIComponent(input.repository.owner);
    const pathRepo = encodeURIComponent(input.repository.repo);
    const url = `https://${GITHUB_API_HOST}/repos/${pathOwner}/${pathRepo}/issues`;
    assertSafeOutboundUrl(url, { allowedHosts: [GITHUB_API_HOST] });

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          ...githubHeaders(this.config.token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          labels: input.labels,
        }),
      });
    } catch (err) {
      return classifyGitHubFailure(err);
    }

    let data: GitHubIssueResponse;
    try {
      data = (await response.json()) as GitHubIssueResponse;
    } catch {
      return classifyGitHubFailure(response, { message: "GitHub returned an unparseable issue response" });
    }

    if (!response.ok) return classifyGitHubFailure(response, data);
    if (typeof data.number !== "number" || typeof data.html_url !== "string") {
      return {
        ok: false,
        adapter: "github",
        category: "invalid-response",
        retryable: false,
        freshness: "unavailable",
        status: response.status,
        message: "GitHub response missing number/html_url",
      };
    }

    return {
      ok: true,
      remote: {
        adapter: "github",
        id: String(data.number),
        number: data.number,
        url: data.html_url,
      },
    };
  }
}
