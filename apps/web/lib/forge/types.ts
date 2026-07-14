export type ForgeAdapterId = "github";

export type EgressClass =
  | "local-integration"
  | "own-repo"
  | "public-hive"
  | "release-distribution";

export type IntegrationAuthority =
  | "bundled-local-git-core"
  | "external-forge-adapter";

export type FreshnessState =
  | "current"
  | "cached"
  | "unavailable"
  | "conflicted";

export type ForgeFailureCategory =
  | "retryable"
  | "unauthorized"
  | "policy-rejected"
  | "conflict"
  | "not-found"
  | "invalid-response";

export interface ForgeRepository {
  forge: ForgeAdapterId;
  owner: string;
  repo: string;
}

export interface ForgeCapabilities {
  adapter: ForgeAdapterId;
  integrationAuthority: IntegrationAuthority;
  supportedEgressClasses: EgressClass[];
  supports: {
    branches: boolean;
    changeRequests: boolean;
    checks: boolean;
    issues: boolean;
    releases: boolean;
  };
}

export interface ForgeFailure {
  ok: false;
  adapter: ForgeAdapterId;
  category: ForgeFailureCategory;
  retryable: boolean;
  freshness: FreshnessState;
  message: string;
  status?: number;
  retryAfterSeconds?: number;
}

export interface RemoteIssue {
  adapter: ForgeAdapterId;
  id: string;
  number: number;
  url: string;
}

export type RemoteIssueResult = { ok: true; remote: RemoteIssue } | ForgeFailure;

export interface CreateIssueInput {
  repository: ForgeRepository;
  title: string;
  body: string;
  labels: string[];
  egressClass: EgressClass;
}
