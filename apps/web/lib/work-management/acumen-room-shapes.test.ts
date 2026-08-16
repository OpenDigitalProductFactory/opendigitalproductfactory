// Contract tests for the per-acumen Workroom shape registry (BI-E0BFFF77).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ACUMEN_PROFESSION_KEYS_PENDING_REGISTRY,
  ACUMEN_ROOM_SHAPES,
  assertAcumenRoomShapeIntegrity,
  getAcumenRoomShape,
} from "./acumen-room-shapes";
import { WORKROOM_SHAPE_KEYS } from "./room-shapes";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const REGISTRY = JSON.parse(
  readFileSync(join(REPO_ROOT, "docs/professions/registry.json"), "utf8"),
) as { families: Array<{ professionKey: string }> };
const REGISTRY_KEYS = new Set(REGISTRY.families.map((family) => family.professionKey));

describe("acumen room shape registry", () => {
  it("covers the six acumens with unique professionKeys and coworkers", () => {
    expect(ACUMEN_ROOM_SHAPES.map((entry) => entry.professionKey)).toEqual([
      "data-architect", "ux-design", "software-engineer",
      "security", "devops-platform", "mcp-integration",
    ]);
    const agents = ACUMEN_ROOM_SHAPES.map((entry) => entry.coworkerAgentId);
    expect(new Set(agents).size).toBe(agents.length);
  });

  it("passes structural integrity (shapes registered, roles valid)", () => {
    expect(() => assertAcumenRoomShapeIntegrity()).not.toThrow();
    const shapeKeys = new Set<string>(WORKROOM_SHAPE_KEYS);
    for (const entry of ACUMEN_ROOM_SHAPES) {
      expect(entry.standingShape).toBe("craft-stewardship");
      expect(entry.reviewShape).toBe("outward-review");
      expect(entry.consequentialShape).toBe("change-consequential");
      expect(shapeKeys.has(entry.standingShape)).toBe(true);
      expect(entry.cadence).toBe("standing");
      expect(entry.participantRoles).toEqual(["accountable", "specialist", "reviewer"]);
      expect(entry.gating).toEqual({
        domainClasses: ["professional-practice", "architecture-tradeoff"],
        autonomyDefault: "propose",
      });
    }
  });

  it("rejects duplicates and unregistered shapes", () => {
    const entry = ACUMEN_ROOM_SHAPES[0];
    expect(() => assertAcumenRoomShapeIntegrity([entry, entry])).toThrow(/duplicate/);
    expect(() =>
      assertAcumenRoomShapeIntegrity([
        // @ts-expect-error deliberately invalid shape key
        { ...entry, standingShape: "not-a-shape" },
      ]),
    ).toThrow(/unregistered shape/);
    expect(() =>
      assertAcumenRoomShapeIntegrity([
        // @ts-expect-error deliberately invalid role
        { ...entry, participantRoles: ["accountable", "wizard"] },
      ]),
    ).toThrow(/invalid role/);
  });

  it("cross-checks every professionKey against docs/professions/registry.json", () => {
    const pending = new Set(ACUMEN_PROFESSION_KEYS_PENDING_REGISTRY);
    for (const entry of ACUMEN_ROOM_SHAPES) {
      expect(
        REGISTRY_KEYS.has(entry.professionKey) || pending.has(entry.professionKey),
        `${entry.professionKey} is neither a registry family nor a declared pending key`,
      ).toBe(true);
    }
  });

  it("keeps the pending-registry exception list a ratchet, not a hole", () => {
    const used = new Set(ACUMEN_ROOM_SHAPES.map((entry) => entry.professionKey));
    for (const key of ACUMEN_PROFESSION_KEYS_PENDING_REGISTRY) {
      // The moment the family lands in the registry, the exception must be removed.
      expect(REGISTRY_KEYS.has(key), `${key} is now in the registry; remove it from the pending list`).toBe(false);
      expect(used.has(key), `${key} is declared pending but unused`).toBe(true);
    }
  });

  it("resolves lookups by professionKey and returns null for unknown keys", () => {
    expect(getAcumenRoomShape("security")).toMatchObject({
      coworkerAgentId: "security-engineer",
    });
    expect(getAcumenRoomShape("finance")).toBeNull();
  });
});
