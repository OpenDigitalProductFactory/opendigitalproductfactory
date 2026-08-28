"use client";

import { useEffect, useState } from "react";

import {
  getMyContributorMcpReadiness,
  listAvailableMcpScopes,
  listMcpTokenTemplates,
  listMyMcpTokens,
  type McpTokenTemplateSummary,
} from "@/lib/actions/mcp-tokens";
import type { ContributorMcpReadiness } from "@/lib/mcp/contributor-readiness";
import { defaultMcpTokenScopes, type McpTokenScopeTier } from "@/lib/mcp-token-scopes";

export type McpTokenRow = {
  id: string;
  name: string;
  prefix: string;
  tokenSuffix: string;
  canCopy: boolean;
  capability: "read" | "write";
  scope: McpTokenScopeTier;
  scopes: string[];
  lastUsedAt: string | null;
  idleDays: number | null;
  kind: string;
  buildId: string | null;
  /** Acting coworker this token speaks as; null = anonymous (BI-B986A18B). */
  agentId: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function useMcpTokenManagerInitialState(onError: (message: string) => void) {
  const [tokens, setTokens] = useState<McpTokenRow[]>([]);
  const [initialLoadPending, setInitialLoadPending] = useState(true);
  const [contributorReadiness, setContributorReadiness] =
    useState<ContributorMcpReadiness | null>(null);
  const [scopes, setScopes] = useState<string[]>([]);
  const [templates, setTemplates] = useState<McpTokenTemplateSummary[]>([]);
  const [formScopes, setFormScopes] = useState<Set<string>>(() => new Set());
  const [archivedCount, setArchivedCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listMyMcpTokens(),
      listAvailableMcpScopes(),
      listMcpTokenTemplates(),
      getMyContributorMcpReadiness({ probe: false }),
    ])
      .then(([tokensResult, scopesResult, templatesResult, readinessResult]) => {
        if (cancelled) return;
        if (tokensResult.ok) {
          setTokens(tokensResult.tokens);
          setArchivedCount(tokensResult.archivedCount);
        }
        if (readinessResult.ok) setContributorReadiness(readinessResult.readiness);
        setScopes(scopesResult.scopes);
        setTemplates(templatesResult.templates);
        setFormScopes((current) =>
          current.size > 0 ? current : new Set(defaultMcpTokenScopes(scopesResult.scopes)),
        );
      })
      .catch(() => {
        if (!cancelled) onError("MCP token state unavailable. Refresh and try again.");
      })
      .finally(() => {
        if (!cancelled) setInitialLoadPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  return {
    archivedCount,
    contributorReadiness,
    formScopes,
    initialLoadPending,
    scopes,
    setArchivedCount,
    setContributorReadiness,
    setFormScopes,
    setTokens,
    templates,
    tokens,
  };
}
