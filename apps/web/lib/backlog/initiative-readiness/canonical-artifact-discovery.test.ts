import { describe, expect, it, vi } from "vitest";

import { discoverCanonicalDesignArtifact, discoverCanonicalReviewArtifact, prepareCurrentDesignObservation, readCurrentDesignArtifact } from "./canonical-artifact-discovery";

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const BLOB_SHA = "9f2c1d4e6b8a0c2e4f6a8b0c2d4e6f8a0b2c4d6e";
const OTHER_BLOB_SHA = "0a1b2c3d4e5f60718293a4b5c6d7e8f900112233";

describe("current canonical design observation", () => {
  const snapshot = () => ({
    kind: "bound" as const, itemRowId: "item-row", itemId: "BI-X", selection: "docs/superpowers/specs/x.md",
    baselineId: "baseline-1", baselineDigest: "sha256:old",
    artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "org/repo", commitSha: BASE_SHA,
      path: "docs/superpowers/specs/x.md", providerBlobId: BLOB_SHA },
    room: { capsuleId: "WC-X", repositoryFullName: "org/repo", baseSha: BASE_SHA, headSha: HEAD_SHA, headBranch: "fix/x" },
  });
  function ports() {
    return { loadBinding: vi.fn().mockResolvedValue(snapshot()),
      readCurrentArtifact: vi.fn().mockResolvedValue({ state: "verified", digest: "sha256:new" }),
      lockBinding: vi.fn().mockResolvedValue(undefined) };
  }
  it("reads immutable bytes outside the transaction and revalidates without another provider call", async () => {
    const p = ports();
    const prepared = await prepareCurrentDesignObservation({ itemId: "BI-X", ports: p });
    expect(prepared.evidence).toEqual({ state: "verified", digest: "sha256:new" });
    expect(p.lockBinding).not.toHaveBeenCalled();
    expect(await prepared.admissionGuard({} as never)).toEqual(prepared.evidence);
    expect(p.lockBinding).toHaveBeenCalledTimes(1);
    expect(p.readCurrentArtifact).toHaveBeenCalledTimes(1);
  });
  it.each(["baselineId", "selection"] as const)("refuses a same-head concurrent %s change", async field => {
    const p = ports();
    const prepared = await prepareCurrentDesignObservation({ itemId: "BI-X", ports: p });
    p.loadBinding.mockResolvedValue({ ...snapshot(), [field]: "changed" });
    expect(await prepared.admissionGuard({} as never)).toEqual({ state: "unavailable" });
  });
  it("refuses a concurrent head change during the provider read", async () => {
    const p = ports();
    p.readCurrentArtifact.mockImplementation(async () => {
      p.loadBinding.mockResolvedValue({ ...snapshot(), room: { ...snapshot().room, headSha: "f".repeat(40) } });
      return { state: "verified", digest: "sha256:new" };
    });
    expect((await prepareCurrentDesignObservation({ itemId: "BI-X", ports: p })).evidence).toEqual({ state: "unavailable" });
  });
  it("retains explicit provider unavailability instead of old baseline success", async () => {
    const p = ports(); p.readCurrentArtifact.mockResolvedValue({ state: "unavailable" });
    const prepared = await prepareCurrentDesignObservation({ itemId: "BI-X", ports: p });
    expect(prepared.evidence).toEqual({ state: "unavailable" });
    expect(await prepared.admissionGuard({} as never)).toEqual({ state: "unavailable" });
  });
  it("does not read provider bytes for inherited, document or absent own repository scope", async () => {
    const p = ports(); p.loadBinding.mockResolvedValue({ kind: "not-applicable" });
    const prepared = await prepareCurrentDesignObservation({ itemId: "BI-X", ports: p });
    expect(prepared.evidence).toEqual({ state: "not-applicable" });
    expect(p.readCurrentArtifact).not.toHaveBeenCalled();
  });
  function stored() {
    const bound = snapshot();
    const baselineRow = { id: "baseline-row", kind: "initiative_scope_baseline", gateKey: null, recordedAt: new Date(0),
      payload: { schemaVersion: 1, baselineId: bound.baselineId, supersedesBaselineId: null,
        subject: { kind: "backlog-item", id: "BI-X" }, profile: "feature", artifactDigest: bound.baselineDigest,
        artifactRef: bound.artifactRef } };
    const store = { backlogItem: { findFirst: vi.fn().mockResolvedValue({ id: "item-row", itemId: "BI-X", body: bound.selection }) },
      backlogItemActivity: { findMany: vi.fn().mockResolvedValue([baselineRow]) },
      workroom: { findMany: vi.fn().mockResolvedValue([bound.room]) } };
    return { store, baselineRow };
  }
  function multipleRooms() {
    const fixture = stored();
    const rooms = [snapshot().room, { ...snapshot().room, capsuleId: "WC-OTHER", headBranch: "fix/other" }]
      .map(room => ({ ...room, backlogItemId: "item-row", archivedAt: null as Date | null, status: "ready" }));
    fixture.store.workroom.findMany.mockImplementation(async (query: unknown) => {
      const { where } = query as { where: Record<string, unknown> & {
        backlogItemId: { in: string[] }; status: { notIn: string[] } } };
      return rooms.filter(room =>
      where.backlogItemId.in.includes(room.backlogItemId) && room.archivedAt === null
      && !where.status.notIn.includes(room.status)
      && ["repositoryFullName", "headBranch", "baseSha", "headSha"].every(key =>
        where[key] === undefined || where[key] === room[key as keyof typeof room]))
      .map(({ backlogItemId, archivedAt, status, ...room }) => room);
    });
    return { ...fixture, rooms };
  }
  it("binds the exact persisted claim source among multiple subject rooms", async () => {
    const { store } = multipleRooms();
    const readCurrentArtifact = vi.fn().mockResolvedValue({ state: "verified", digest: "sha256:new" });
    const prepared = await prepareCurrentDesignObservation({ itemId: "BI-X", db: store as never,
      claimSource: snapshot().room, ports: { readCurrentArtifact, lockBinding: vi.fn() } });
    expect(prepared.evidence).toEqual({ state: "verified", digest: "sha256:new" });
    expect(readCurrentArtifact).toHaveBeenCalledWith(snapshot());
    expect(await prepared.admissionGuard(store as never)).toEqual(prepared.evidence);
    expect(store.workroom.findMany).toHaveBeenCalledTimes(3);
    expect(store.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ repositoryFullName: "org/repo", headBranch: "fix/x",
        baseSha: BASE_SHA, headSha: HEAD_SHA, backlogItemId: { in: ["item-row", "BI-X"] }, archivedAt: null }) }));
  });
  it("keeps an unscoped read ambiguous with the same multiple rooms", async () => {
    const { store } = multipleRooms(); const readCurrentArtifact = vi.fn();
    expect((await prepareCurrentDesignObservation({ itemId: "BI-X", db: store as never,
      ports: { readCurrentArtifact } })).evidence).toEqual({ state: "unavailable" });
    expect(readCurrentArtifact).not.toHaveBeenCalled();
  });
  it("does not turn inherited-only scope into a claim-owned amendment", async () => {
    const { store } = multipleRooms(); store.backlogItemActivity.findMany.mockResolvedValue([]);
    const readCurrentArtifact = vi.fn();
    expect((await prepareCurrentDesignObservation({ itemId: "BI-X", db: store as never,
      claimSource: snapshot().room, ports: { readCurrentArtifact } })).evidence).toEqual({ state: "not-applicable" });
    expect(store.workroom.findMany).not.toHaveBeenCalled();
    expect(readCurrentArtifact).not.toHaveBeenCalled();
  });
  it.each([
    { baseSha: undefined }, { headSha: null }, { headSha: "bad" },
    { repositoryFullName: "other/repo" }, { headBranch: "fix/missing" },
    { baseSha: "a".repeat(40) }, { headSha: "b".repeat(40) },
  ])("refuses an incomplete or nonmatching claim source %j", async change => {
    const { store } = multipleRooms(); const readCurrentArtifact = vi.fn();
    expect((await prepareCurrentDesignObservation({ itemId: "BI-X", db: store as never,
      claimSource: { ...snapshot().room, ...change }, ports: { readCurrentArtifact } })).evidence)
      .toEqual({ state: "unavailable" });
    expect(readCurrentArtifact).not.toHaveBeenCalled();
  });
  it.each(["foreign-subject", "archived", "abandoned", "head-changed", "room-replaced", "baseline-changed", "selection-changed"])(
    "refuses %s before admitting the selected claim", async scenario => {
      const { store, rooms, baselineRow } = multipleRooms();
      const prepared = await prepareCurrentDesignObservation({ itemId: "BI-X", db: store as never,
        claimSource: snapshot().room, ports: { readCurrentArtifact: vi.fn().mockResolvedValue({ state: "verified", digest: "sha256:new" }),
          lockBinding: vi.fn() } });
      expect(prepared.evidence.state).toBe("verified");
      if (scenario === "foreign-subject") rooms[0]!.backlogItemId = "foreign-row";
      if (scenario === "archived") rooms[0]!.archivedAt = new Date();
      if (scenario === "abandoned") rooms[0]!.status = "abandoned";
      if (scenario === "head-changed") rooms[0]!.headSha = "f".repeat(40);
      if (scenario === "room-replaced") rooms[0]!.capsuleId = "WC-REPLACED";
      if (scenario === "baseline-changed") baselineRow.payload.baselineId = "baseline-changed";
      if (scenario === "selection-changed") store.backlogItem.findFirst.mockResolvedValue({
        id: "item-row", itemId: "BI-X", body: "docs/superpowers/specs/other.md" });
      expect(await prepared.admissionGuard(store as never)).toEqual({ state: "unavailable" });
    });
  it("rejects selected source drift during the provider read", async () => {
    const { store, rooms } = multipleRooms();
    const prepared = await prepareCurrentDesignObservation({ itemId: "BI-X", db: store as never,
      claimSource: snapshot().room, ports: { readCurrentArtifact: async () => {
        rooms[0]!.headSha = "f".repeat(40); return { state: "verified", digest: "sha256:new" };
      } } });
    expect(prepared.evidence).toEqual({ state: "unavailable" });
  });
  it("loads the actual subject baseline and room instead of accepting a caller digest", async () => {
    const { store } = stored();
    const readCurrentArtifact = vi.fn().mockResolvedValue({ state: "verified", digest: "sha256:new" });
    const prepared = await prepareCurrentDesignObservation({ itemId: "BI-X", db: store as never, ports: { readCurrentArtifact } });
    expect(prepared.evidence).toEqual({ state: "verified", digest: "sha256:new" });
    expect(readCurrentArtifact).toHaveBeenCalledWith(snapshot());
    expect(store.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2,
      where: expect.objectContaining({ backlogItemId: { in: ["item-row", "BI-X"] }, archivedAt: null }) }));
  });
  it("uses normal canonical discovery before falling back to an unchanged baseline path", async () => {
    const binding = { ...snapshot(), selection: "Source-only repair with no declared design path" };
    const discoverArtifact = vi.fn().mockResolvedValue({ resolved: false, code: "no-canonical-design" });
    const readBlob = vi.fn().mockResolvedValue({ ok: true, data: new TextEncoder().encode("verified bytes"), blobId: BLOB_SHA });
    const result = await readCurrentDesignArtifact(binding, { discoverArtifact, readBlob });
    expect(discoverArtifact).toHaveBeenCalledWith(expect.objectContaining({ backlogBody: binding.selection }));
    expect(readBlob).toHaveBeenCalledWith(expect.objectContaining({ path: binding.artifactRef.path,
      commitSha: HEAD_SHA, expectedBlobId: null }));
    expect(result).toMatchObject({ state: "verified", digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) });
  });
  it.each([false, true])("withholds current verification on a capped comparison (visible design: %s)", async visibleDesign => {
    const files = Array.from({ length: 300 }, (_, index) => ({
      filename: visibleDesign && index === 0 ? "docs/superpowers/specs/visible.md" : `apps/web/lib/file-${index}.ts`,
      sha: BLOB_SHA, status: "modified",
    }));
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse(files));
    const readBlob = vi.fn().mockResolvedValue({ ok: true, data: new TextEncoder().encode("old baseline"), blobId: BLOB_SHA });
    const evidence = await readCurrentDesignArtifact({ ...snapshot(), selection: "No explicit design selection" }, {
      discoverArtifact: async input => discoverCanonicalDesignArtifact({ ...args(fetchImpl as typeof fetch), backlogBody: input.backlogBody }),
      readBlob,
    });
    expect(evidence).toEqual({ state: "unavailable" });
    expect(readBlob).not.toHaveBeenCalled();
  });
  it.each(["ambiguous-canonical-design", "provider-unavailable", "no-canonical-design"])("never substitutes the baseline after unresolved explicit selection (%s)", async code => {
    const readBlob = vi.fn();
    const result = await readCurrentDesignArtifact(snapshot(), {
      discoverArtifact: vi.fn().mockResolvedValue({ resolved: false, code }), readBlob,
    });
    expect(result).toEqual({ state: "unavailable" });
    expect(readBlob).not.toHaveBeenCalled();
  });
  it.each(["missing-artifact", "ambiguous-room", "foreign-baseline", "provider-error"])("keeps %s unavailable through the real snapshot reader", async scenario => {
    const { store, baselineRow } = stored();
    const readCurrentArtifact = vi.fn().mockResolvedValue({ state: "verified", digest: "sha256:new" });
    if (scenario === "missing-artifact") baselineRow.payload.artifactRef = null as never;
    if (scenario === "ambiguous-room") store.workroom.findMany.mockResolvedValue([snapshot().room, snapshot().room]);
    if (scenario === "foreign-baseline") baselineRow.payload.subject.id = "BI-OTHER";
    if (scenario === "provider-error") readCurrentArtifact.mockRejectedValue(new Error("provider unavailable"));
    const prepared = await prepareCurrentDesignObservation({ itemId: "BI-X", db: store as never, ports: { readCurrentArtifact } });
    expect(prepared.evidence).toEqual({ state: "unavailable" });
    expect(await prepared.admissionGuard(store as never)).toEqual({ state: "unavailable" });
  });
});

const db = {
  credentialEntry: { findUnique: vi.fn().mockResolvedValue(null) },
  platformDevConfig: { findUnique: vi.fn().mockResolvedValue({ upstreamRemoteUrl: null }) },
} as unknown as Parameters<typeof discoverCanonicalDesignArtifact>[0]["db"];

function compareResponse(files: unknown) {
  return {
    ok: true,
    json: async () => ({ files }),
  } as unknown as Response;
}

function args(fetchImpl: typeof fetch) {
  return {
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    db,
    fetchImpl,
  };
}

describe("canonical design artifact discovery", () => {
  it.each([
    [".github/workflows/stuck-auto-merge-alarm.yml"],
    [".github/workflows/ci.yml", "scripts/ci-evidence-plan.test.mjs", "docs/architecture/build-gate-runbook.md"],
    ["apps/web/lib/repair.test.ts"],
  ])("binds a source-only PIR to its unique repair artifact (%j)", async (...paths) => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse(paths.map((filename) => ({ filename, sha: BLOB_SHA, status: "modified" }))));
    const result = await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" });
    expect(result).toEqual({ resolved: true, artifact: { path: paths[0], providerBlobId: BLOB_SHA } });
  });

  it("does not turn a source-only repair into a design approval artifact", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([{ filename: ".github/workflows/ci.yml", sha: BLOB_SHA, status: "modified" }]));
    expect(await discoverCanonicalDesignArtifact(args(fetchImpl as unknown as typeof fetch)))
      .toMatchObject({ resolved: false, code: "no-canonical-design" });
  });

  it("retains a unique changed design as the PIR artifact for a multi-file repair", async () => {
    const path = "docs/superpowers/specs/repair.md";
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([path, "apps/web/lib/a.ts", "apps/web/lib/b.ts"].map((filename) => ({ filename, sha: BLOB_SHA, status: "modified" }))));
    expect(await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" }))
      .toEqual({ resolved: true, artifact: { path, providerBlobId: BLOB_SHA } });
  });

  it("refuses ambiguous implementation files rather than arbitrarily choosing one for PIR", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse(["apps/web/lib/a.ts", "apps/web/lib/b.ts"].map((filename) => ({ filename, sha: BLOB_SHA, status: "modified" }))));
    expect(await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" }))
      .toMatchObject({ resolved: false, code: "ambiguous-repair-artifact" });
  });

  // BI-09399355: a break-fix that bumps the plugin manifests alongside its one
  // code change (#5660) was unroutable — four one-line version bumps counted as
  // competing implementation artifacts.
  const versionBump = (filename: string) => ({
    filename, sha: OTHER_BLOB_SHA, status: "modified",
    patch: '@@ -1,6 +1,6 @@\n {\n   "name": "dpf-platform",\n-  "version": "0.2.5",\n+  "version": "0.2.6",\n   "author": {}',
  });

  it("binds the code change when the other files only bump a manifest version", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([
      versionBump("packages/dpf-skill-pack/.claude-plugin/plugin.json"),
      versionBump("packages/dpf-skill-pack/.codex-plugin/plugin.json"),
      { filename: "packages/dpf-skill-pack/hooks/uncommitted-work-guard.mjs", sha: BLOB_SHA, status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" },
      { filename: "packages/dpf-skill-pack/hooks/uncommitted-work-guard.test.mjs", sha: BLOB_SHA, status: "modified" },
    ]));
    expect(await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" }))
      .toEqual({ resolved: true, artifact: { path: "packages/dpf-skill-pack/hooks/uncommitted-work-guard.mjs", providerBlobId: BLOB_SHA } });
  });

  it.each([
    ["changes more than the version", '@@ -1,3 +1,3 @@\n-  "version": "0.2.5",\n+  "version": "0.2.6",\n-  "hooks": "a"\n+  "hooks": "b"'],
    ["arrives without a patch", undefined],
  ])("keeps a manifest as a competing artifact when it %s", async (_label, patch) => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([
      { filename: "packages/dpf-skill-pack/.claude-plugin/plugin.json", sha: OTHER_BLOB_SHA, status: "modified", ...(patch ? { patch } : {}) },
      { filename: "apps/web/lib/a.ts", sha: BLOB_SHA, status: "modified" },
    ]));
    expect(await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" }))
      .toMatchObject({ resolved: false, code: "ambiguous-repair-artifact" });
  });

  it("binds a version bump that is the whole repair", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([versionBump("packages/dpf-skill-pack/.claude-plugin/plugin.json")]));
    expect(await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" }))
      .toEqual({ resolved: true, artifact: { path: "packages/dpf-skill-pack/.claude-plugin/plugin.json", providerBlobId: OTHER_BLOB_SHA } });
  });

  it("does not hide a second implementation artifact because it was deleted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([
      { filename: "apps/web/lib/a.ts", sha: BLOB_SHA, status: "modified" },
      { filename: "apps/web/lib/b.ts", sha: OTHER_BLOB_SHA, status: "removed" },
    ]));
    expect(await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" }))
      .toMatchObject({ resolved: false, code: "ambiguous-repair-artifact" });
  });

  it("does not infer uniqueness after silently dropping malformed provider entries", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([
      { filename: "apps/web/lib/a.ts", sha: BLOB_SHA, status: "modified" }, null,
    ]));
    expect(await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" }))
      .toMatchObject({ resolved: false, code: "provider-unavailable" });
  });

  it("does not infer unique repair scope from a provider-capped comparison", async () => {
    const files = Array.from({ length: 300 }, (_, index) => ({ filename: index === 0 ? "apps/web/lib/a.ts" : `docs/${index}.md`, sha: BLOB_SHA, status: "modified" }));
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse(files));
    expect(await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" }))
      .toMatchObject({ resolved: false, code: "provider-unavailable" });
  });

  it.each([
    { filename: ".github/workflows/ci.yml", sha: BLOB_SHA, status: "removed" },
    { filename: "../outside.ts", sha: BLOB_SHA, status: "modified" },
    { filename: "apps/web/lib/a.ts", sha: "invalid", status: "modified" },
  ])("refuses absent or invalid repair bytes (%j)", async (file) => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([file]));
    expect(await discoverCanonicalReviewArtifact({ ...args(fetchImpl as unknown as typeof fetch), purpose: "post-implementation-review" }))
      .toMatchObject({ resolved: false, code: "no-repair-artifact" });
  });

  it("reuses the explicitly referenced unchanged design at the immutable head", async () => {
    const path = "docs/superpowers/specs/2026-09-03-coordinated-workrooms-design.md";
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true,
      json: async () => ({ type: "file", path, sha: BLOB_SHA }),
    } as Response);
    const result = await discoverCanonicalDesignArtifact({
      ...args(fetchImpl as unknown as typeof fetch),
      backlogBody: `## Design\n\`${path}\` and Phase D of the existing plan.`,
    });
    expect(result).toEqual({ resolved: true, artifact: { path, providerBlobId: BLOB_SHA } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(`/contents/${path}?ref=${HEAD_SHA}`);
  });

  it("refuses multiple explicitly referenced designs without selecting a changed file", async () => {
    const fetchImpl = vi.fn();
    const result = await discoverCanonicalDesignArtifact({
      ...args(fetchImpl as unknown as typeof fetch),
      backlogBody: "`docs/superpowers/specs/a.md` and `docs/superpowers/specs/b.md`",
    });
    expect(result).toMatchObject({ resolved: false, code: "ambiguous-canonical-design" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses traversal in an explicit design reference before provider access", async () => {
    const fetchImpl = vi.fn();
    const result = await discoverCanonicalDesignArtifact({
      ...args(fetchImpl as unknown as typeof fetch),
      backlogBody: "`docs/superpowers/specs/../../private.md`",
    });
    expect(result).toMatchObject({ resolved: false, code: "no-canonical-design" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("deduplicates Markdown links and section references to the same design", async () => {
    const path = "docs/superpowers/specs/a.md";
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true,
      json: async () => ({ type: "file", path, sha: BLOB_SHA }),
    } as Response);
    const result = await discoverCanonicalDesignArtifact({
      ...args(fetchImpl as unknown as typeof fetch),
      backlogBody: `[Design](${path}#scope) and \`${path}\``,
    });
    expect(result).toMatchObject({ resolved: true, artifact: { path } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not replace a missing explicit design with an unrelated changed spec", async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, body: { cancel } } as unknown as Response);
    const result = await discoverCanonicalDesignArtifact({
      ...args(fetchImpl as unknown as typeof fetch), backlogBody: "`docs/superpowers/specs/missing.md`",
    });
    expect(result).toMatchObject({ resolved: false, code: "provider-unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    { type: "dir", path: "docs/superpowers/specs/a.md", sha: BLOB_SHA },
    { type: "file", path: "docs/superpowers/specs/other.md", sha: BLOB_SHA },
    { type: "file", path: "docs/superpowers/specs/a.md", sha: "invalid" },
  ])("refuses unverifiable explicit content without falling back to compare (%j)", async (content) => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => content } as Response);
    const result = await discoverCanonicalDesignArtifact({
      ...args(fetchImpl as unknown as typeof fetch), backlogBody: "`docs/superpowers/specs/a.md`",
    });
    expect(result).toMatchObject({ resolved: false, code: "provider-unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses and closes the isolated production transport when no fetch is injected", async () => {
    const frameworkFetch = vi.fn().mockRejectedValue(new Error("framework context unavailable"));
    vi.stubGlobal("fetch", frameworkFetch);
    const isolatedFetch = vi.fn().mockResolvedValue(compareResponse([
      { filename: "docs/superpowers/specs/2026-08-25-a-design.md", sha: BLOB_SHA, status: "added" },
    ]));
    const close = vi.fn().mockResolvedValue(undefined);

    try {
      const result = await discoverCanonicalDesignArtifact({
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
        db,
        transportFactory: () => ({ fetch: isolatedFetch as unknown as typeof fetch, close }),
      } as never);

      expect(result).toMatchObject({ resolved: true, artifact: { providerBlobId: BLOB_SHA } });
      expect(isolatedFetch).toHaveBeenCalledTimes(1);
      expect(frameworkFetch).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("maps production transport construction failure to provider-unavailable", async () => {
    const result = await discoverCanonicalDesignArtifact({
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      db,
      transportFactory: () => {
        throw new Error("dispatcher unavailable");
      },
    });

    expect(result).toMatchObject({ resolved: false, code: "provider-unavailable" });
  });

  it("binds the single spec changed across the branch range, taking the blob id from the provider", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([
      { filename: "apps/web/lib/thing.ts", sha: OTHER_BLOB_SHA, status: "modified" },
      { filename: "docs/superpowers/specs/2026-08-25-a-design.md", sha: BLOB_SHA, status: "added" },
    ]));

    const result = await discoverCanonicalDesignArtifact(args(fetchImpl as unknown as typeof fetch));

    expect(result).toEqual({
      resolved: true,
      artifact: { path: "docs/superpowers/specs/2026-08-25-a-design.md", providerBlobId: BLOB_SHA },
    });
    // The compare RANGE, not the head commit: a design authored across several
    // commits would be invisible to `GET /commits/{sha}`.
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(`compare/${BASE_SHA}...${HEAD_SHA}`);
  });

  it("reports no canonical design when the branch changed no spec", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([
      { filename: "apps/web/lib/thing.ts", sha: OTHER_BLOB_SHA, status: "modified" },
    ]));

    const result = await discoverCanonicalDesignArtifact(args(fetchImpl as unknown as typeof fetch));

    expect(result).toMatchObject({ resolved: false, code: "no-canonical-design" });
    expect(result.resolved === false && result.nextAction).toContain("docs/superpowers/specs/");
  });

  it("refuses to choose when more than one spec changed, and names the candidates", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([
      { filename: "docs/superpowers/specs/2026-08-25-a-design.md", sha: BLOB_SHA, status: "added" },
      { filename: "docs/superpowers/specs/2026-08-25-b-design.md", sha: OTHER_BLOB_SHA, status: "added" },
    ]));

    const result = await discoverCanonicalDesignArtifact(args(fetchImpl as unknown as typeof fetch));

    expect(result).toMatchObject({ resolved: false, code: "ambiguous-canonical-design" });
    expect(result.resolved === false && result.nextAction).toContain("2026-08-25-b-design.md");
  });

  it("ignores a spec the branch deleted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(compareResponse([
      { filename: "docs/superpowers/specs/2026-08-25-a-design.md", sha: BLOB_SHA, status: "added" },
      { filename: "docs/superpowers/specs/2026-01-01-old-design.md", sha: OTHER_BLOB_SHA, status: "removed" },
    ]));

    const result = await discoverCanonicalDesignArtifact(args(fetchImpl as unknown as typeof fetch));

    expect(result).toMatchObject({ resolved: true, artifact: { providerBlobId: BLOB_SHA } });
  });

  it.each(["baseSha", "headSha"] as const)("names %s and supplies both identity fields in adoption repair", async (field) => {
    const fetchImpl = vi.fn();

    const result = await discoverCanonicalDesignArtifact({
      ...args(fetchImpl as unknown as typeof fetch),
      [field]: "",
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ resolved: false, code: "provider-unavailable" });
    expect(result.resolved === false && result.nextAction).toContain("adopt_worktree");
    expect(result.resolved === false && result.nextAction).toContain(field);
    expect(result.resolved === false && result.nextAction).toContain("adopt_worktree(headBranch, baseSha, headSha)");
  });

  it("reports provider unavailability rather than guessing when the compare fails", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      body: { cancel },
    } as unknown as Response);

    const result = await discoverCanonicalDesignArtifact(args(fetchImpl as unknown as typeof fetch));

    expect(result).toMatchObject({ resolved: false, code: "provider-unavailable" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
