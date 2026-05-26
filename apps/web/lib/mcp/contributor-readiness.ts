import {
  copyMcpApiTokenPlaintext,
  listMcpApiTokens,
} from "@/lib/auth/mcp-api-token";
import {
  CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS,
  getMcpTokenTemplate,
  type McpTokenScopeTier,
} from "@/lib/mcp-token-scopes";

const PROBE_TTL_MS = 60_000;

export type ContributorMcpReadinessStatus =
  | "ready"
  | "needs_authorization"
  | "needs_reissue"
  | "needs_grants"
  | "needs_identity_binding";

export type ContributorMcpRecommendedAction =
  | "none"
  | "issue_development_token"
  | "rotate_development_token"
  | "test_connection";

export type ContributorMcpProbe =
  | { status: "not_run" }
  | { status: "success"; checkedAt: string; toolCount: number }
  | { status: "failed"; checkedAt: string; message: string }
  | { status: "unavailable"; message: string };

export type ContributorMcpTokenRow = Awaited<ReturnType<typeof listMcpApiTokens>>[number];

export type ContributorMcpReadiness = {
  status: ContributorMcpReadinessStatus;
  recommendedAction: ContributorMcpRecommendedAction;
  identityBinding: "bound" | "not_available";
  token: null | {
    id: string;
    name: string;
    prefix: string;
    tokenSuffix: string;
    scope: McpTokenScopeTier;
    scopes: string[];
    lastUsedAt: string | null;
    expiresAt: string | null;
  };
  missingGrants: string[];
  requiredGrants: string[];
  recommendedScopes: string[];
  probe: ContributorMcpProbe;
};

export type ContributorMcpReadinessOptions = {
  probe?: boolean;
  baseUrl?: string;
  now?: Date;
};

const probeCache = new Map<string, { checkedAtMs: number; probe: ContributorMcpProbe }>();

function cacheProbe(
  tokenId: string,
  checkedAtMs: number,
  probe: ContributorMcpProbe,
): ContributorMcpProbe {
  probeCache.set(tokenId, { checkedAtMs, probe });
  return probe;
}

function isActive(token: ContributorMcpTokenRow, now: Date): boolean {
  if (token.revokedAt != null) return false;
  if (token.expiresAt != null && token.expiresAt.getTime() < now.getTime()) return false;
  return true;
}

function scopeCanWrite(scope: string): boolean {
  return scope === "write" || scope === "admin";
}

function missingRequiredGrants(token: ContributorMcpTokenRow): string[] {
  const scopes = new Set(token.scopes);
  return CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS.filter((grant) => !scopes.has(grant));
}

function sortByFreshness(a: ContributorMcpTokenRow, b: ContributorMcpTokenRow): number {
  const aTime = (a.lastUsedAt ?? a.createdAt).getTime();
  const bTime = (b.lastUsedAt ?? b.createdAt).getTime();
  return bTime - aTime;
}

function projectToken(token: ContributorMcpTokenRow): ContributorMcpReadiness["token"] {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    tokenSuffix: token.tokenSuffix,
    scope: token.scope,
    scopes: token.scopes,
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    expiresAt: token.expiresAt?.toISOString() ?? null,
  };
}

function baseResult(
  status: ContributorMcpReadinessStatus,
  token: ContributorMcpTokenRow | null,
  missingGrants: string[],
): ContributorMcpReadiness {
  const recommendedScopes = getMcpTokenTemplate("development")?.grants ?? [
    ...CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS,
  ];
  const recommendedAction: ContributorMcpRecommendedAction =
    status === "ready"
      ? "test_connection"
      : status === "needs_grants"
        ? "rotate_development_token"
        : status === "needs_identity_binding"
          ? "none"
          : "issue_development_token";

  return {
    status,
    recommendedAction,
    identityBinding: "not_available",
    token: token ? projectToken(token) : null,
    missingGrants,
    requiredGrants: [...CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS],
    recommendedScopes: [...recommendedScopes],
    probe: { status: "not_run" },
  };
}

async function runProbe(
  token: ContributorMcpTokenRow,
  opts: Required<Pick<ContributorMcpReadinessOptions, "baseUrl" | "now">>,
): Promise<ContributorMcpProbe> {
  const cached = probeCache.get(token.id);
  if (cached && opts.now.getTime() - cached.checkedAtMs < PROBE_TTL_MS) {
    return cached.probe;
  }

  const copied = await copyMcpApiTokenPlaintext(token.id);
  if (!copied.ok) {
    return cacheProbe(token.id, opts.now.getTime(), {
      status: "unavailable",
      message: `Token plaintext unavailable: ${copied.error}`,
    });
  }

  const checkedAt = opts.now.toISOString();
  try {
    const response = await fetch(`${opts.baseUrl}/api/mcp/v1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${copied.plaintext}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    if (!response.ok) {
      return cacheProbe(token.id, opts.now.getTime(), {
        status: "failed",
        checkedAt,
        message: `HTTP ${response.status}`,
      });
    }
    const payload = (await response.json()) as {
      result?: { tools?: unknown[] };
      error?: { message?: string };
    };
    const tools = payload.result?.tools;
    if (!Array.isArray(tools) || tools.length === 0) {
      return cacheProbe(token.id, opts.now.getTime(), {
        status: "failed",
        checkedAt,
        message: payload.error?.message ?? "tools/list returned no tools",
      });
    }
    const probe: ContributorMcpProbe = {
      status: "success",
      checkedAt,
      toolCount: tools.length,
    };
    return cacheProbe(token.id, opts.now.getTime(), probe);
  } catch (err) {
    return cacheProbe(token.id, opts.now.getTime(), {
      status: "failed",
      checkedAt,
      message: err instanceof Error ? err.message : "Unknown probe failure",
    });
  }
}

export async function getContributorMcpReadiness(
  userId: string,
  opts: ContributorMcpReadinessOptions = {},
): Promise<ContributorMcpReadiness> {
  const now = opts.now ?? new Date();
  const operatorTokens = (await listMcpApiTokens(userId))
    .filter((token) => token.kind === "operator")
    .sort(sortByFreshness);
  const activeOperatorTokens = operatorTokens.filter((token) => isActive(token, now));

  if (activeOperatorTokens.length === 0) {
    if (operatorTokens.length > 0) {
      return baseResult("needs_reissue", operatorTokens[0] ?? null, [
        ...CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS,
      ]);
    }
    return baseResult("needs_authorization", null, [
      ...CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS,
    ]);
  }

  const readyToken = activeOperatorTokens.find(
    (token) => scopeCanWrite(token.scope) && missingRequiredGrants(token).length === 0,
  );
  if (!readyToken) {
    const token = activeOperatorTokens[0]!;
    return baseResult("needs_grants", token, missingRequiredGrants(token));
  }

  const result = baseResult("ready", readyToken, []);
  if (opts.probe) {
    result.probe = await runProbe(readyToken, {
      baseUrl: opts.baseUrl ?? process.env.APP_URL ?? process.env.AUTH_URL ?? "http://127.0.0.1:3000",
      now,
    });
  }
  return result;
}

export function _resetContributorMcpReadinessProbeCacheForTests(): void {
  probeCache.clear();
}
