import { vi } from "vitest";

export const bytes = Buffer.from("canonical plan bytes\n", "utf8");
export const locator = {
  kind: "repo-blob-at-commit" as const,
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  commitSha: "a".repeat(40),
  path: "docs/superpowers/plans/test.md",
  providerBlobId: "b".repeat(40),
};

type CapsuleRow = {
  capsuleId: string;
  headBranch: string | null;
  headSha: string | null;
  createdByPrincipalId: string | null;
  activities: Array<{ recordedByAgentId: string | null }>;
};

export function capsule(overrides: Partial<CapsuleRow> = {}): CapsuleRow {
  return {
    capsuleId: "WC-TEST0001",
    headBranch: "feat/test",
    headSha: locator.commitSha,
    createdByPrincipalId: "principal-author",
    activities: [{ recordedByAgentId: "agent-author" }],
    ...overrides,
  };
}

export function db(options: {
  capsules?: CapsuleRow[];
  emailPrincipalIds?: string[];
  agentAliasValues?: string[];
} = {}) {
  const capsules = options.capsules ?? [capsule()];
  const emailPrincipalIds = options.emailPrincipalIds ?? ["principal-author"];
  const agentAliasValues = options.agentAliasValues ?? ["agent-author"];
  return {
    workroom: {
      findMany: vi.fn(async () => capsules.map((row) => ({
        ...row,
        // The resolver filters candidates itself, so the store returns every
        // live capsule for the subject regardless of head state.
        activities: row.activities.filter((activity) => activity.recordedByAgentId !== null),
      }))),
    },
    principalAlias: {
      findMany: vi.fn(async ({ where }: { where: { aliasType: string } }) => where.aliasType === "email"
        ? emailPrincipalIds.map((principalId) => ({ principalId }))
        : agentAliasValues.map((aliasValue) => ({ aliasValue }))),
    },
    credentialEntry: { findUnique: vi.fn(async () => null) },
    platformDevConfig: {
      findUnique: vi.fn(async () => ({ upstreamRemoteUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git" })),
    },
    scheduledJob: { findUnique: vi.fn(async () => null) },
  };
}

export function providerFetch(signOff = "Signed-off-by: Author <author@example.com>") {
  return vi.fn(async (url: string | URL | Request) => String(url).includes("/commits/")
    ? new Response(JSON.stringify({ commit: { message: `docs: canonical\n\n${signOff}` } }), { status: 200 })
    : new Response(JSON.stringify({
      type: "file",
      sha: locator.providerBlobId,
      encoding: "base64",
      content: bytes.toString("base64"),
    }), { status: 200, headers: { "content-type": "application/json" } }));
}

