// Contract tests for the consolidation-bet registry (BI-D9B58004).
//
// The registry's value is that every selector points at a REAL artifact — a
// file on disk, a Prisma model in schema.prisma, an MCP tool in mcp-tools.ts.
// These tests enforce that mechanically so the registry cannot drift into
// fabrication as consolidations rename or remove their targets.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CONSOLIDATION_BETS,
  CONSOLIDATION_BET_ITEM_IDS,
  CONSOLIDATION_MOVE_TYPES,
  CONSOLIDATION_WAVES,
  getConsolidationBet,
} from "./consolidation-bets";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SCHEMA = readFileSync(join(REPO_ROOT, "packages/db/prisma/schema.prisma"), "utf8");
const MCP_TOOLS = readFileSync(join(REPO_ROOT, "apps/web/lib/mcp-tools.ts"), "utf8");

describe("consolidation-bets registry", () => {
  it("has unique, well-formed bet keys", () => {
    const keys = CONSOLIDATION_BETS.map((bet) => bet.betKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^BET-\d+$/);
  });

  it("has unique, well-formed backlog item ids", () => {
    const ids = CONSOLIDATION_BETS.flatMap((bet) => bet.backlogItemIds);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^BI-[0-9A-F]{8}$/);
    expect(CONSOLIDATION_BET_ITEM_IDS.size).toBe(ids.length);
  });

  it("uses only closed-vocabulary move types, waves, effort, leverage", () => {
    for (const bet of CONSOLIDATION_BETS) {
      expect(bet.moveTypes.length).toBeGreaterThan(0);
      for (const move of bet.moveTypes) {
        expect(CONSOLIDATION_MOVE_TYPES).toContain(move);
      }
      expect(CONSOLIDATION_WAVES).toContain(bet.wave);
      expect(["S", "M", "L", "XL"]).toContain(bet.effort);
      expect(["H", "M", "L"]).toContain(bet.leverage);
      expect(bet.leafEstimate).toBeGreaterThan(0);
    }
  });

  it("every file selector exists in the tree (no fabricated paths)", () => {
    for (const bet of CONSOLIDATION_BETS) {
      for (const file of bet.selectors.files) {
        expect(existsSync(join(REPO_ROOT, file)), `${bet.betKey}: missing ${file}`).toBe(true);
      }
    }
  });

  it("every model selector is a declared Prisma model", () => {
    for (const bet of CONSOLIDATION_BETS) {
      for (const model of bet.selectors.models) {
        expect(
          new RegExp(`^model ${model} `, "m").test(SCHEMA),
          `${bet.betKey}: model ${model} not in schema.prisma`,
        ).toBe(true);
      }
    }
  });

  it("every tool selector is a registered MCP tool name", () => {
    for (const bet of CONSOLIDATION_BETS) {
      for (const tool of bet.selectors.tools) {
        expect(
          MCP_TOOLS.includes(`"${tool}"`),
          `${bet.betKey}: tool ${tool} not in mcp-tools.ts`,
        ).toBe(true);
      }
    }
  });

  it("every bet carries at least one projectable selector", () => {
    for (const bet of CONSOLIDATION_BETS) {
      const total =
        bet.selectors.models.length + bet.selectors.tools.length + bet.selectors.files.length;
      expect(total, `${bet.betKey} has no selectors`).toBeGreaterThan(0);
    }
  });

  it("getConsolidationBet resolves by key", () => {
    expect(getConsolidationBet("BET-6")?.leafEstimate).toBe(1000);
    expect(getConsolidationBet("BET-99")).toBeUndefined();
  });
});
