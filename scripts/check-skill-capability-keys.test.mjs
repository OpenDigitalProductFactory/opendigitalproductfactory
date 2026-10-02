import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MIN_CAPABILITY_DECLARATIONS,
  MIN_CAPABILITY_KEYS,
  MIN_SKILL_FILES,
  evaluateSkillCapabilities,
  parseCapabilitySourceOfTruth,
  parseSkillCapability,
} from "./check-skill-capability-keys.mjs";

// A fixture in the real source shape: the union spans several lines and carries
// a comment line between members, and the record has nested braces.
const PERMISSIONS_FIXTURE = `export type PlatformRoleId = "HR-000" | "HR-100";

export type CapabilityKey =
  | "view_portfolio"
  | "view_platform"
  // a comment between members, as the real file has
  | "manage_platform";

type Permission = { roles: PlatformRoleId[] };

export const PERMISSIONS: Record<CapabilityKey, Permission> = {
  view_portfolio:  { roles: ["HR-000", "HR-100"] },
  view_platform:   { roles: ["HR-000"] },
  manage_platform: { roles: ["HR-000"] },
};

export function can(user: UserContext, capability: CapabilityKey): boolean {
  return PERMISSIONS[capability].roles.includes(user.role);
}
`;

describe("parseCapabilitySourceOfTruth", () => {
  it("extracts the CapabilityKey union members and stops at the terminator", () => {
    const { unionKeys } = parseCapabilitySourceOfTruth(PERMISSIONS_FIXTURE);
    assert.deepEqual(unionKeys, ["view_portfolio", "view_platform", "manage_platform"]);
  });

  it("extracts the PERMISSIONS record keys and stops at the closing brace", () => {
    const { permissionKeys } = parseCapabilitySourceOfTruth(PERMISSIONS_FIXTURE);
    assert.deepEqual(permissionKeys, ["view_portfolio", "view_platform", "manage_platform"]);
  });

  it("does not pick up the PlatformRoleId union that precedes it", () => {
    const { unionKeys } = parseCapabilitySourceOfTruth(PERMISSIONS_FIXTURE);
    assert.ok(!unionKeys.includes("HR-000"));
  });
});

describe("parseSkillCapability", () => {
  const fm = (line) => `---\nname: x\n${line}\ntaskType: "analysis"\n---\n\n# Body\n`;

  it("reads a double-quoted value", () => {
    assert.equal(parseSkillCapability(fm('capability: "view_platform"')), "view_platform");
  });

  it("reads a single-quoted value", () => {
    assert.equal(parseSkillCapability(fm("capability: 'view_platform'")), "view_platform");
  });

  it("reads a bare scalar — all three shapes exist in the tree", () => {
    assert.equal(parseSkillCapability(fm("capability: manage_platform")), "manage_platform");
  });

  it("returns null for an explicit null", () => {
    assert.equal(parseSkillCapability(fm("capability: null")), null);
  });

  it("returns undefined when the field is absent", () => {
    assert.equal(parseSkillCapability("---\nname: x\n---\n\n# Body\n"), undefined);
  });

  it("does not read a capability: line from the body, only the frontmatter", () => {
    const raw = "---\nname: x\n---\n\ncapability: view_bogus\n";
    assert.equal(parseSkillCapability(raw), undefined);
  });
});

describe("evaluateSkillCapabilities", () => {
  const keys = Array.from({ length: MIN_CAPABILITY_KEYS }, (_, i) => `view_k${i}`);
  const skillsOf = (extra = []) => [
    ...Array.from({ length: MIN_SKILL_FILES }, (_, i) => ({
      file: `skills/x/s${i}.skill.md`,
      capability: keys[i % keys.length],
    })),
    ...extra,
  ];
  const base = (overrides = {}) => ({
    unionKeys: keys,
    permissionKeys: keys,
    skills: skillsOf(),
    ...overrides,
  });

  it("passes when every declared capability is a known key", () => {
    const r = evaluateSkillCapabilities(base());
    assert.equal(r.ok, true, r.errors.join("\n"));
    assert.equal(r.checked, MIN_SKILL_FILES);
  });

  it("FAILS and names the file for an invented capability", () => {
    const r = evaluateSkillCapabilities(
      base({
        skills: skillsOf([
          { file: "skills/ops/bogus.skill.md", capability: "view_build_studio" },
        ]),
      }),
    );
    assert.equal(r.ok, false);
    assert.ok(
      r.errors.some(
        (e) => e.includes("skills/ops/bogus.skill.md") && e.includes('"view_build_studio"'),
      ),
      r.errors.join("\n"),
    );
  });

  it("accepts null and absent capability as ungated, not as violations", () => {
    const r = evaluateSkillCapabilities(
      base({
        skills: skillsOf([
          { file: "skills/a/null.skill.md", capability: null },
          { file: "skills/a/absent.skill.md", capability: undefined },
        ]),
      }),
    );
    assert.equal(r.ok, true, r.errors.join("\n"));
    assert.equal(r.checked, MIN_SKILL_FILES);
  });

  it("covers BOTH namespaces — a pack SKILL.md violation fails too", () => {
    const r = evaluateSkillCapabilities(
      base({
        skills: skillsOf([
          { file: "packages/dpf-skill-pack/skills/foo/SKILL.md", capability: "view_nope" },
        ]),
      }),
    );
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("packages/dpf-skill-pack/skills/foo/SKILL.md")));
  });

  // --- Parser floors: a regex that stops matching must FAIL, never report a
  // clean sweep over an empty set.
  it("PARSER FLOOR: fails when the PERMISSIONS parse comes back short", () => {
    const r = evaluateSkillCapabilities(base({ permissionKeys: keys.slice(0, 2), unionKeys: keys.slice(0, 2) }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.startsWith("PARSER FLOOR") && e.includes("PERMISSIONS keys")));
  });

  it("PARSER FLOOR: fails when the union parse comes back short", () => {
    const r = evaluateSkillCapabilities(base({ unionKeys: [] }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.startsWith("PARSER FLOOR") && e.includes("union members")));
  });

  it("PARSER FLOOR: fails when skill discovery comes back short", () => {
    const r = evaluateSkillCapabilities(base({ skills: [] }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.startsWith("PARSER FLOOR") && e.includes("skill files")));
  });

  it("PARSER FLOOR: fails when the frontmatter regex stops reading the field", () => {
    const r = evaluateSkillCapabilities({
      unionKeys: keys,
      permissionKeys: keys,
      skills: Array.from({ length: MIN_SKILL_FILES }, (_, i) => ({
        file: `skills/x/s${i}.skill.md`,
        capability: undefined,
      })),
    });
    assert.equal(r.ok, false);
    assert.ok(
      r.errors.some((e) => e.startsWith("PARSER FLOOR") && e.includes("capability: field")),
      r.errors.join("\n"),
    );
    assert.ok(MIN_CAPABILITY_DECLARATIONS > 0);
  });

  it("an empty skill set NEVER reports success", () => {
    const r = evaluateSkillCapabilities(base({ skills: [] }));
    assert.equal(r.ok, false);
  });

  it("FAILS when the two parses of the source of truth disagree", () => {
    const r = evaluateSkillCapabilities(base({ unionKeys: [...keys, "view_ghost"] }));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.startsWith("SOURCE DISAGREEMENT") && e.includes("view_ghost")));
  });

  it("reports no per-skill verdict while the known set is untrustworthy", () => {
    const r = evaluateSkillCapabilities(
      base({
        unionKeys: [],
        skills: skillsOf([{ file: "skills/a/bogus.skill.md", capability: "view_nope" }]),
      }),
    );
    assert.equal(r.ok, false);
    assert.equal(r.checked, 0);
    assert.ok(!r.errors.some((e) => e.includes("skills/a/bogus.skill.md")));
  });
});
