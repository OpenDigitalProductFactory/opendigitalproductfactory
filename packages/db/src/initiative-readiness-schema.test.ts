import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260808235000_initiative_readiness_receipts/migration.sql", import.meta.url),
  "utf8",
);

function productionTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && entry.name !== "node_modules") files.push(...productionTypeScriptFiles(path));
    } else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.test\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

describe("initiative readiness persistence", () => {
  it("types gate lanes and serves latest-receipt reads", () => {
    expect(schema).toContain("enum InitiativeGateKey");
    expect(schema).toMatch(/gateKey\s+InitiativeGateKey\?/);
    expect(schema).toContain("@@index([backlogItemId, gateKey, recordedAt(sort: Desc), id(sort: Desc)])");
  });

  it("pins exactly one immutable artifact branch with restrictive foreign keys", () => {
    expect(schema).toContain("model InitiativeArtifactRetentionPin");
    expect(schema).toMatch(/baselineActivityId\s+String\s+@unique/);
    expect(schema).toMatch(/buildArtifactRevision\s+BuildArtifactRevision\?.*onDelete: Restrict/);
    expect(schema).toMatch(/documentVersion\s+DocumentVersion\?.*onDelete: Restrict/);
    expect(schema).toMatch(/documentBlob\s+DocumentBlob\?.*onDelete: Restrict/);
    expect(migration).toContain("initiative_artifact_retention_pin_shape");
    expect(migration).toContain('dv."contentBlobId" IS NOT DISTINCT FROM NEW."documentBlobId"');
  });

  it("keeps governance records and pins append-only while ordinary activity remains deletable", () => {
    expect(migration).toContain("initiative_governance_activity_immutable");
    expect(migration).toContain("initiative_retention_pin_immutable");
    expect(migration).toContain("initiative_build_artifact_revision_immutable");
    expect(migration).toContain("initiative_document_version_immutable");
    expect(migration).toContain("initiative_document_blob_immutable");
    expect(migration).toContain("initiative_backlog_delete_guard");
    expect(migration).toContain("initiative_gate_receipt");
    expect(migration).toContain("initiative_scope_baseline");
    expect(migration).toContain("initiative_objective_mapping");
    expect(migration).toContain("initiative_readiness_decision");
  });

  it("has no production writer that mutates or deletes a retention pin", () => {
    const webRoot = fileURLToPath(new URL("../../../apps/web", import.meta.url));
    const forbidden = productionTypeScriptFiles(webRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return /initiativeArtifactRetentionPin\s*\.\s*(?:update|updateMany|delete|deleteMany)\s*\(/.test(source)
        ? [path]
        : [];
    });
    expect(forbidden).toEqual([]);
  });
});
