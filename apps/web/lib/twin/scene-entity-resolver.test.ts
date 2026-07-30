import { describe, expect, it, vi } from "vitest";

import {
  OPERATIONAL_SCENE_ENTITY_KINDS,
  resolveSceneEntityRefs,
  type SceneEntityLookup,
  type SceneEntityRecord,
} from "./scene-entity-resolver";

const organization = { id: "org-row", orgId: "org-public" };

function record(
  entityKind: (typeof OPERATIONAL_SCENE_ENTITY_KINDS)[number],
  id: string,
  label: string,
): SceneEntityRecord {
  return {
    entityKind,
    id,
    label,
    operationalStatus: "active",
    active: true,
  };
}

describe("resolveSceneEntityRefs", () => {
  it("batches and deduplicates supported references while preserving placement order", async () => {
    const rows = new Map([
      ["care-resource", [record("care-resource", "room-1", "Treatment room 1")]],
      ["table", [record("table", "table-1", "Window table 1")]],
    ]);
    const lookup: SceneEntityLookup = {
      resolveOrganization: vi.fn(async () => organization),
      findMany: vi.fn(async ({ kind }) => rows.get(kind) ?? []),
    };

    const result = await resolveSceneEntityRefs({
      orgId: organization.orgId,
      refs: [
        { kind: "table", id: "table-1" },
        { kind: "care-resource", id: "room-1" },
        { kind: "table", id: "table-1" },
        { kind: "table", id: "missing-table" },
        { kind: "future-kind", id: "future-1" },
        { kind: "rentable-unit", id: "" },
      ],
      lookup,
    });

    expect(lookup.resolveOrganization).toHaveBeenCalledOnce();
    expect(lookup.findMany).toHaveBeenCalledTimes(2);
    expect(lookup.findMany).toHaveBeenCalledWith({
      kind: "table",
      ids: ["table-1", "missing-table"],
      organization,
    });
    expect(lookup.findMany).toHaveBeenCalledWith({
      kind: "care-resource",
      ids: ["room-1"],
      organization,
    });
    expect(result).toEqual([
      expect.objectContaining({
        status: "resolved",
        ref: { kind: "table", id: "table-1" },
        label: "Window table 1",
      }),
      expect.objectContaining({
        status: "resolved",
        ref: { kind: "care-resource", id: "room-1" },
        label: "Treatment room 1",
      }),
      expect.objectContaining({
        status: "resolved",
        ref: { kind: "table", id: "table-1" },
      }),
      {
        status: "missing",
        ref: { kind: "table", id: "missing-table" },
        reason: "entity-not-found",
      },
      {
        status: "unsupported",
        ref: { kind: "future-kind", id: "future-1" },
        reason: "unsupported-kind",
      },
      {
        status: "missing",
        ref: { kind: "rentable-unit", id: "" },
        reason: "invalid-reference",
      },
    ]);
  });

  it("fails closed without entity reads when the organization does not exist", async () => {
    const lookup: SceneEntityLookup = {
      resolveOrganization: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    };

    const result = await resolveSceneEntityRefs({
      orgId: "unknown-org",
      refs: [
        { kind: "customer-site", id: "site-1" },
        { kind: "unknown-kind", id: "x" },
      ],
      lookup,
    });

    expect(lookup.findMany).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        status: "missing",
        ref: { kind: "customer-site", id: "site-1" },
        reason: "organization-not-found",
      },
      {
        status: "unsupported",
        ref: { kind: "unknown-kind", id: "x" },
        reason: "unsupported-kind",
      },
    ]);
  });

  it("publishes the closed v1 entity-kind registry", () => {
    expect(OPERATIONAL_SCENE_ENTITY_KINDS).toEqual([
      "care-resource",
      "rentable-unit",
      "customer-site",
      "infra-ci",
      "table",
    ]);
  });
});
