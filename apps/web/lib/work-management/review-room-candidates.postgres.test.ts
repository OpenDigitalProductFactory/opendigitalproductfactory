import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasExecutionUncertainty } from "@/lib/shared/execution-uncertainty";
import { loadReviewRoomCandidates, type ReviewRoomCandidateClient } from "./review-room-candidates";

// A governed local slot supplies its isolated URL. Only GitHub Actions CI may
// use DATABASE_URL, which that workflow binds to its ephemeral test database.
// These are database/query fixtures, not independent review or runtime receipts.
const cloudCi = process.env.GITHUB_ACTIONS === "true" && process.env.CI === "true";
const url = process.env.DPF_SQL_TEST_DATABASE_URL ?? process.env.DPF_LOCAL_CI_TEST_DATABASE_URL
  ?? (cloudCi ? process.env.DATABASE_URL : undefined);
if ((process.env.DPF_LOCAL_CI_SLOT_KEY || cloudCi) && !url) {
  throw new Error("The admitted local slot or cloud CI did not supply its PostgreSQL test URL; candidate SQL verification is unrun.");
}
const schema = `review_room_candidates_${randomUUID().replaceAll("-", "")}`;
const now = new Date("2026-10-23T23:30:00Z");
const head = "a".repeat(40);
const migrationPath = fileURLToPath(new URL("../../../../packages/db/prisma/migrations/20261023233000_review_room_candidate_indexes/migration.sql", import.meta.url));

function binding(room = "WC-ONE", gate = "design-spec") {
  return { writerToolName: "record_initiative_design_review", itemId: "BI-ONE", gate,
    workroomRef: { kind: "workroom-head", workroomId: room, repositoryFullName: "fixture/repo", branchName: "fix/fixture", headSha: head },
    artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "fixture/repo", commitSha: head, path: "docs/spec.md", providerBlobId: "b".repeat(40) } };
}

describe.skipIf(!url)("bounded review candidate discovery on PostgreSQL", () => {
  let client: Client;
  let lastQuery: { text: string; values: unknown[] };
  let sqlFailure: unknown;
  const db = { $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
    lastQuery = { text: parts.reduce((text, part, index) => text + (index ? `$${index}` : "") + part, ""), values };
    try { return (await client.query(lastQuery)).rows; }
    catch (error) { sqlFailure = error; throw error; }
  } } as unknown as ReviewRoomCandidateClient;

  beforeAll(async () => {
    client = new Client({ connectionString: url, application_name: schema,
      options: `-c search_path=${schema} -c statement_timeout=7000` });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    // Deliberately no public search-path fallback. Physical tables let PostgreSQL
    // execute the production SQL and the exact migration's expression indexes.
    await client.query(`
      CREATE TABLE "TaskRun" (id text PRIMARY KEY, "taskRunId" text UNIQUE NOT NULL,
        "userId" text NOT NULL, status text NOT NULL, "createdAt" timestamptz NOT NULL,
        "updatedAt" timestamptz NOT NULL, "lastHeartbeatAt" timestamptz, "archivedAt" timestamptz,
        "a2aMetadata" jsonb, "progressPayload" jsonb);
      CREATE TABLE "TaskNode" (id text PRIMARY KEY, "taskNodeId" text NOT NULL, "taskRunId" text NOT NULL,
        title text NOT NULL, status text NOT NULL, "updatedAt" timestamptz NOT NULL, "requestContract" jsonb);
      CREATE INDEX ON "TaskNode" ("taskRunId", status);
      CREATE TABLE "WorkCapsule" (id text PRIMARY KEY, "capsuleId" text UNIQUE NOT NULL,
        "repositoryFullName" text, "headBranch" text, "headSha" text, "backlogItemId" text);
      CREATE TABLE "BacklogItem" (id text PRIMARY KEY, "itemId" text UNIQUE NOT NULL);
      CREATE TABLE "EmployeeProfile" (id text PRIMARY KEY, "userId" text UNIQUE, "displayName" text);
      CREATE TABLE "McpApiToken" (id text PRIMARY KEY, "userId" text NOT NULL, "agentId" text);
    `);
    // Oversized historical locators must not wedge a forward-only index migration.
    await insert("oversized-before-migration", { initiativeReviewBinding: binding("x".repeat(10000)) });
    await client.query(await readFile(migrationPath, "utf8"));
  });
  afterAll(async () => {
    if (client && /^review_room_candidates_[a-f0-9]{32}$/.test(schema)) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    await client?.end();
  });
  beforeEach(async () => {
    sqlFailure = undefined;
    await client.query('TRUNCATE "TaskRun", "TaskNode", "WorkCapsule", "BacklogItem", "EmployeeProfile", "McpApiToken"');
    await client.query(`INSERT INTO "BacklogItem" VALUES ('item-row', 'BI-ONE');
      INSERT INTO "WorkCapsule" VALUES ('room-one', 'WC-ONE', 'fixture/repo', 'fix/fixture', '${head}', 'item-row'),
        ('room-two', 'WC-TWO', 'fixture/repo', 'fix/fixture', '${head}', 'BI-ONE');
      INSERT INTO "EmployeeProfile" VALUES ('profile', 'requester', 'Requester');
      INSERT INTO "McpApiToken" VALUES ('original-token', 'requester', 'AGT-ORIGINAL'), ('foreign-token', 'foreign-user', 'AGT-FOREIGN');`);
  });

  async function insert(id: string, metadata: unknown, progress: unknown = {}, createdAt = now, status = "working") {
    await client.query(`INSERT INTO "TaskRun" (id,"taskRunId","userId",status,"createdAt","updatedAt","lastHeartbeatAt","a2aMetadata","progressPayload")
      VALUES ($1,$2,'requester',$3,$4,$4,$4,$5::jsonb,$6::jsonb)`, [id, `TR-${id}`, status, createdAt, JSON.stringify(metadata), JSON.stringify(progress)]);
  }
  async function read(rooms = ["WC-ONE"]) {
    const result = await loadReviewRoomCandidates(db, rooms);
    // Negative controls must not pass because the production reader caught SQL errors.
    expect(sqlFailure).toBeUndefined();
    return result;
  }

  it("discovers ordinary initiative bindings without the semantic gate metadata", async () => {
    await insert("ordinary", { trigger: "external-mcp", apiTokenId: "original-token", requestDigest: "d".repeat(64), initiativeReviewBinding: binding() });
    const result = await read();
    expect(result.partial).toBe(false);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: "ordinary", capsuleId: "WC-ONE", reviewKind: "initiative-review",
      initiativeBinding: binding(), bindingTruncated: false, metadataTrigger: "external-mcp", requesterAgentId: "AGT-ORIGINAL",
      requestDigest: "d".repeat(64), roomBacklogItemId: "BI-ONE", roomHeadSha: head,
      user: { employeeProfile: { displayName: "Requester" } }, nodes: [] });
  });

  it("keeps multiple gates, competing originals and both review families visible", async () => {
    await insert("design", { initiativeReviewBinding: binding() }, { executionUncertainty: { settlement: "unknown" } });
    await insert("design-competing", { initiativeReviewBinding: binding() }, {}, new Date(now.getTime() + 1000), "completed");
    await insert("architecture", { initiativeReviewBinding: binding("WC-ONE", "architecture") });
    await insert("semantic", { gateKind: "semantic-review", capsuleId: "WC-ONE" });
    const result = await read();
    expect(result.rows.map(row => row.id).sort()).toEqual(["architecture", "design", "design-competing", "semantic"]);
    expect(hasExecutionUncertainty(result.rows.find(row => row.id === "design")!.progressPayload)).toBe(true);
  });

  it("retains malformed and foreign bindings for qualification without widening room scope", async () => {
    await insert("malformed", { initiativeReviewBinding: { workroomRef: { workroomId: "WC-ONE" } } });
    await insert("foreign", { apiTokenId: "foreign-token", initiativeReviewBinding: { ...binding(), itemId: "BI-FOREIGN",
      workroomRef: { ...binding().workroomRef, repositoryFullName: "foreign/repo", branchName: "other", headSha: "c".repeat(40) } } });
    await insert("outside", { initiativeReviewBinding: binding("WC-OUTSIDE") });
    const result = await read();
    expect(result.rows.map(row => row.id).sort()).toEqual(["foreign", "malformed"]);
    expect(result.rows.find(row => row.id === "foreign")!.requesterAgentId).toBeNull();
    expect(result.rows.every(row => row.roomRepositoryFullName === "fixture/repo")).toBe(true);
  });

  it("withholds oversized room identity strings by bytes and marks that room incomplete", async () => {
    await insert("ordinary", { initiativeReviewBinding: binding() });
    await client.query('UPDATE "WorkCapsule" SET "repositoryFullName"=$1,"headBranch"=$1,"headSha"=$2 WHERE "capsuleId"=\'WC-ONE\'',
      ["\u00e9".repeat(257), "a".repeat(65)]);
    const result = await read();
    expect(result.rows[0]).toMatchObject({ roomRepositoryFullName: null, roomHeadBranch: null, roomHeadSha: null });
    expect(result.partial).toBe(true);
    expect(result.partialCapsuleIds).toEqual(["WC-ONE"]);
  });

  it("reports overflow by room and lane without starving another room or family", async () => {
    for (let index = 0; index < 25; index++) await insert(`busy-${index}`, { initiativeReviewBinding: binding() }, {}, new Date(now.getTime() + index));
    await insert("other-room", { initiativeReviewBinding: binding("WC-TWO") });
    await insert("semantic", { gateKind: "semantic-review", capsuleId: "WC-ONE" });
    const result = await read(["WC-ONE", "WC-TWO"]);
    expect(result.rows).toHaveLength(22);
    expect(result.rows.some(row => row.id === "other-room")).toBe(true);
    expect(result.rows.some(row => row.id === "semantic")).toBe(true);
    expect(result.partialCapsuleIds).toEqual(["WC-ONE"]);
    expect(result.partial).toBe(true);
  });

  it("preserves dual-family ambiguity and explicitly caps room input", async () => {
    await insert("dual", { gateKind: "semantic-review", capsuleId: "WC-ONE", initiativeReviewBinding: binding() });
    const result = await read(["WC-ONE", ...Array.from({ length: 100 }, (_, index) => `WC-EXTRA-${index}`)]);
    expect(result.rows.map(row => row.reviewKind).sort()).toEqual(["initiative-review", "semantic-review"]);
    expect(result.rows.every(row => row.ambiguousReviewKind)).toBe(true);
    expect(result.partialCapsuleIds).toContain("WC-ONE");
    expect(result.partialCapsuleIds).toContain("WC-EXTRA-99");
  });

  it("bounds JSON and node fields while retaining uncertainty and overflow signals", async () => {
    const large = "private-content".repeat(100000);
    await insert("large", { prompt: large, initiativeReviewBinding: { ...binding(), extra: large } }, {
      prompt: large, semanticReview: { prompt: large }, terminalWriterWait: { prompt: large },
      terminalWriterDispatchFailure: { prompt: large }, executionUncertainty: { diagnostics: large },
    });
    await client.query(`INSERT INTO "TaskNode" SELECT 'node-'||i,'TN-'||i,'large',$1,'working',$2,
      jsonb_build_object('agentId','AGT-NODE','prompt',$3::text) FROM generate_series(1,14) i`, ["title".repeat(5000), now, large]);
    const result = await read();
    const row = result.rows[0];
    expect(row.bindingTruncated).toBe(true);
    expect(row.progressTruncated).toBe(true);
    expect(row.nodesTruncated).toBe(true);
    expect(row.initiativeBinding).toBeNull();
    expect(hasExecutionUncertainty(row.progressPayload)).toBe(true);
    expect(row.nodes).toHaveLength(13);
    expect(row.nodes[0].requestContract).toEqual({ agentId: "AGT-NODE" });
    expect(Buffer.byteLength(JSON.stringify(row))).toBeLessThan(25000);
    expect(JSON.stringify(row)).not.toContain("private-content");
    expect(result.partialCapsuleIds).toEqual(["WC-ONE"]);
  });

  it.each([{}, { executionUncertainty: null }, { executionUncertainty: false },
    { terminalWriterWait: "malformed" }, { terminalWriterWait: { schemaVersion: 99 } },
    { terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer", resumeMode: "same-taskrun", writerToolName: "writer", attempt: 1,
      observedAt: now.toISOString(), dispatchContract: "required-tool-call" } },
  ])("preserves canonical uncertainty semantics for %j", async progress => {
    await insert("uncertainty", { initiativeReviewBinding: binding() }, progress);
    expect(hasExecutionUncertainty((await read()).rows[0].progressPayload)).toBe(hasExecutionUncertainty(progress));
  });

  it("executes the complete production query using both ordered expression indexes", async () => {
    await client.query(`INSERT INTO "TaskRun" (id,"taskRunId","userId",status,"createdAt","updatedAt","a2aMetadata")
      SELECT 'unrelated-'||i,'TR-unrelated-'||i,'requester','working',$1,$1,
        jsonb_build_object('gateKind','semantic-review','capsuleId','WC-UNRELATED-'||i,
          'initiativeReviewBinding',jsonb_build_object('workroomRef',jsonb_build_object('workroomId','WC-UNRELATED-'||i)))
      FROM generate_series(1,10000) i`, [now]);
    await insert("ordinary", { initiativeReviewBinding: binding() });
    await insert("semantic", { gateKind: "semantic-review", capsuleId: "WC-ONE" });
    await client.query('ANALYZE "TaskRun"');
    expect((await read()).rows).toHaveLength(2);
    const explained = await client.query({ text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${lastQuery.text}`, values: lastQuery.values });
    const plan = explained.rows[0]["QUERY PLAN"][0].Plan;
    const nodes: Record<string, any>[] = [];
    const walk = (node: Record<string, any>) => { nodes.push(node); for (const child of node.Plans ?? []) walk(child); };
    walk(plan);
    const initiative = nodes.find(node => node["Index Name"] === "TaskRun_active_initiative_review_room_created_idx");
    const semantic = nodes.find(node => node["Index Name"] === "TaskRun_active_semantic_review_room_created_idx");
    expect(initiative?.["Index Cond"]).toContain("initiativeReviewBinding");
    expect(semantic?.["Index Cond"]).toContain("capsuleId");
    expect(nodes.filter(node => node["Node Type"] === "Seq Scan" && node["Relation Name"] === "TaskRun")).toEqual([]);
    expect(nodes.filter(node => node["Node Type"] === "Limit").length).toBeGreaterThanOrEqual(3);
    expect(initiative?.["Actual Rows"]).toBeLessThanOrEqual(21);
    expect(semantic?.["Actual Rows"]).toBeLessThanOrEqual(21);
    expect(plan["Actual Rows"]).toBe(2);
  });
});
