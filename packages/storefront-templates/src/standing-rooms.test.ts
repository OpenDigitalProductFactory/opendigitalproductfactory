// Standing-room derivation + the demarcation control gate (BI-7E7B93DF).
//
// The proactive-Workroom design draws a boundary between platform substrate,
// archetype profile, and instance overlay. A boundary stated only in prose is
// not a control gate — these tests are the gate.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_ARCHETYPES } from "./archetypes/index";
import {
  operatesASourceRepository,
  deriveStandingRooms,
  standingRoomShapeKeys,
} from "./standing-rooms";

const PACKAGE_SRC = __dirname;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (full.endsWith(".ts") && !full.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("the archetype layer never names one business", () => {
  // Demarcation test 1. An instance fact that reaches this package would ship
  // one operator's business to every install of the archetype.
  // Forge hostnames are matched as plain substrings, not as a regular
  // expression. This scan asks "does this file mention a forge anywhere", which
  // is the opposite of validating that a URL points at an allowed host — an
  // unanchored host regex here would read as a bypassable authorization check
  // (CodeQL js/regex/missing-regexp-anchor) when it is nothing of the kind.
  const FORGE_HOSTS = ["github.com", "gitlab.com", "bitbucket.org", "bitbucket.com"];

  const FORBIDDEN: { label: string; pattern: RegExp }[] = [
    { label: "owner/repo coordinate", pattern: /\b[\w.-]+\/[\w.-]+\.git\b/ },
    { label: "bearer/API token", pattern: /\b(ghp_|github_pat_|dpfmcp_|sk-[A-Za-z0-9]{16,})/ },
    { label: "private key block", pattern: /BEGIN [A-Z ]*PRIVATE KEY/ },
  ];

  /** Instance facts found in one file's text. Empty means clean. */
  function instanceFactsIn(body: string): string[] {
    const found: string[] = [];
    const haystack = body.toLowerCase();
    for (const host of FORGE_HOSTS) {
      if (haystack.includes(host)) found.push(`forge hostname ${host}`);
    }
    for (const { label, pattern } of FORBIDDEN) {
      if (pattern.test(body)) found.push(label);
    }
    return found;
  }

  it("actually detects an instance fact — the guard is not vacuous", () => {
    // A gate that cannot fail is not a gate. If the detector is ever weakened,
    // this fails before the sweep below starts quietly passing on everything.
    expect(instanceFactsIn("const repo = 'https://github.com/acme/widgets';"))
      .toContain("forge hostname github.com");
    expect(instanceFactsIn("clone git@host:acme/widgets.git")).toContain(
      "owner/repo coordinate",
    );
    expect(instanceFactsIn("token = 'ghp_exampleexample'")).toContain("bearer/API token");
    expect(instanceFactsIn("const rooms = deriveStandingRooms(archetype);")).toEqual([]);
  });

  it("contains no forge coordinates, hostnames, or credential-shaped strings", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(PACKAGE_SRC)) {
      const found = instanceFactsIn(readFileSync(file, "utf8"));
      for (const label of found) {
        offenders.push(`${path.relative(PACKAGE_SRC, file)}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("deriveStandingRooms", () => {
  // Demarcation test 2. Derived, never authored per archetype: if this cannot
  // resolve for every leaf archetype with no per-install input, the room set is
  // authored somewhere and a new archetype would silently get nothing.
  it("resolves a complete, well-formed room set for every leaf archetype", () => {
    expect(ALL_ARCHETYPES.length).toBeGreaterThan(0);
    for (const archetype of ALL_ARCHETYPES) {
      const rooms = deriveStandingRooms(archetype);
      expect(rooms.length, archetype.archetypeId).toBeGreaterThan(0);

      const keys = new Set(rooms.map((room) => room.key));
      expect(keys.size, `${archetype.archetypeId} has duplicate room keys`).toBe(rooms.length);

      for (const room of rooms) {
        expect(room.label.length, `${archetype.archetypeId}/${room.key}`).toBeGreaterThan(0);
        expect(room.purpose.length, `${archetype.archetypeId}/${room.key}`).toBeGreaterThan(0);
        // Every sub-room's parent must exist in the same set — a dangling
        // `contains` is a room nobody can find.
        if (room.parentKey !== null) {
          expect(keys, `${archetype.archetypeId}/${room.key} parent`).toContain(room.parentKey);
        }
      }
    }
  });

  it("covers all four portfolios for every leaf archetype", () => {
    // The live install had ZERO rooms carrying productsAndServicesSold. The
    // derivation must not be able to reproduce that hole.
    for (const archetype of ALL_ARCHETYPES) {
      const roles = new Set(deriveStandingRooms(archetype).map((room) => room.portfolioRole));
      for (const role of [
        "foundational",
        "manufactureAndDeliver",
        "forEmployees",
        "productsAndServicesSold",
      ] as const) {
        expect(roles, `${archetype.archetypeId} missing ${role}`).toContain(role);
      }
    }
  });

  it("gives every archetype the rooms any business needs", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const shapes = standingRoomShapeKeys(archetype);
      for (const shape of [
        "payables-watch",
        "vendor-renewal-watch",
        "inquiry-response-watch",
        "credential-hygiene-watch",
      ]) {
        expect(shapes, archetype.archetypeId).toContain(shape);
      }
    }
  });

  it("adds the source-operations rooms only to categories whose product is software", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const shapes = standingRoomShapeKeys(archetype);
      const delivery = shapes.includes("pull-request-flow-watch");
      expect(delivery, archetype.archetypeId).toBe(operatesASourceRepository(archetype));
    }
  });

  it("gives the software-platform archetype the source-operations rooms", () => {
    const platform = ALL_ARCHETYPES.find((a) => a.archetypeId === "software-platform");
    expect(platform).toBeDefined();
    const shapes = standingRoomShapeKeys(platform!);
    for (const shape of [
      "dependency-advisory-watch",
      "repository-policy-drift-watch",
      "pull-request-flow-watch",
      "issue-triage-watch",
      "release-readiness-watch",
    ]) {
      expect(shapes).toContain(shape);
    }
  });

  it("is deterministic — the same archetype derives the same rooms", () => {
    for (const archetype of ALL_ARCHETYPES.slice(0, 5)) {
      expect(deriveStandingRooms(archetype)).toEqual(deriveStandingRooms(archetype));
    }
  });
});
