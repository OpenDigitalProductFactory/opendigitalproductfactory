// packages/db/src/persona-reachability.test.ts
//
// BI-5CCBF85B. The behaviour under test is "every coworker that executes work
// is handed its own job description, and never another coworker's".
//
// The non-regression suite matters as much as the fix: 29 of 130 coworkers
// already resolved before this change, and they must land on the byte-identical
// file afterwards. A fix that silently re-pointed a working coworker at a
// different job would be worse than the defect.

import { describe, it, expect } from "vitest";
import {
  resolvePersonaTemplate,
  findDuplicateDeclarations,
  type PersonaTemplateIndexEntry,
} from "./persona-reachability";

/** The shape the real index has: basename slug, directory category, declared id. */
const index: PersonaTemplateIndexEntry[] = [
  // A coworker reachable the pre-fix way: slug row, route-persona category.
  { category: "route-persona", slug: "coo", declaredAgentId: "AGT-ORCH-000" },
  { category: "route-persona", slug: "hr-specialist", declaredAgentId: "AGT-WS-HR" },
  // A coworker whose job description lives under `specialist` — unreachable
  // before this change because the lookup only queried `route-persona`.
  {
    category: "specialist",
    slug: "policy-enforcement-agent",
    declaredAgentId: "AGT-100",
  },
  // The ambiguity that makes basename matching unsafe: this file is named
  // `data-architect` but belongs to AGT-BUILD-DA, while the identity bridge
  // maps the slug `data-architect` to AGT-WS-DATA-ARCHITECT.
  {
    category: "specialist",
    slug: "data-architect",
    declaredAgentId: "AGT-BUILD-DA",
  },
  // A prompt that is not a job description at all.
  { category: "specialist", slug: "shared-identity", declaredAgentId: null },
];

describe("resolvePersonaTemplate", () => {
  it("finds a job description that lives under the specialist category", () => {
    // The 60 files the pre-fix lookup could never reach.
    const resolution = resolvePersonaTemplate("AGT-100", index);

    expect(resolution.ref).toEqual({
      category: "specialist",
      slug: "policy-enforcement-agent",
    });
    expect(resolution.source).toBe("declared-agent-id");
  });

  it("resolves a canonical id whose persona file is named for its slug", () => {
    const resolution = resolvePersonaTemplate("AGT-ORCH-000", index);

    expect(resolution.ref).toEqual({ category: "route-persona", slug: "coo" });
  });

  it("resolves a dual-seeded slug row to the same file as its canonical id", () => {
    // `coo` and `AGT-ORCH-000` are the same coworker. Which namespace the
    // runtime happens to hold must not change the job it is given.
    const bySlug = resolvePersonaTemplate("coo", index);
    const byCanonical = resolvePersonaTemplate("AGT-ORCH-000", index);

    expect(bySlug.ref).toEqual(byCanonical.ref);
  });

  it("never hands a coworker another coworker's job description", () => {
    // The bridge maps the slug `data-architect` to AGT-WS-DATA-ARCHITECT, and a
    // file named `data-architect` exists — but it declares AGT-BUILD-DA. Basename
    // matching would return it. Silently plausible and wrong is worse than the
    // fallback, so this must not resolve.
    const resolution = resolvePersonaTemplate("AGT-WS-DATA-ARCHITECT", index);

    expect(resolution.ref).toBeNull();
    expect(resolution.source).toBe("unresolved");
  });

  it("reports what it tried when a coworker has no job description", () => {
    const resolution = resolvePersonaTemplate("AGT-NOT-A-COWORKER", index);

    expect(resolution.ref).toBeNull();
    expect(resolution.source).toBe("unresolved");
    // The unresolved signal has to name the probes, or an operator cannot tell
    // a missing file from a mis-keyed one.
    expect(resolution.attempted).toContain(
      "declared-agent-id:AGT-NOT-A-COWORKER",
    );
    expect(resolution.attempted.length).toBeGreaterThan(1);
  });

  it("ignores prompts that declare no coworker identity", () => {
    // A shared include must never be returned as somebody's job description.
    const resolutions = index
      .map((entry) => resolvePersonaTemplate(entry.slug, index))
      .filter((r) => r.ref?.slug === "shared-identity");

    expect(resolutions).toEqual([]);
  });

  it("falls back to the pre-fix lookup when a declared id was never persisted", () => {
    // An admin-overridden template keeps its content but loses frontmatter the
    // seed would have written. It must still resolve exactly as it did before.
    const overridden: PersonaTemplateIndexEntry[] = [
      { category: "route-persona", slug: "coo", declaredAgentId: null },
    ];

    const resolution = resolvePersonaTemplate("coo", overridden);

    expect(resolution.ref).toEqual({ category: "route-persona", slug: "coo" });
    expect(resolution.source).toBe("route-persona-slug");
  });

  it("resolves through the identity bridge when only the slug file exists", () => {
    const bridged: PersonaTemplateIndexEntry[] = [
      { category: "route-persona", slug: "hr-specialist", declaredAgentId: null },
    ];

    const resolution = resolvePersonaTemplate("AGT-WS-HR", bridged);

    expect(resolution.ref).toEqual({
      category: "route-persona",
      slug: "hr-specialist",
    });
    expect(resolution.source).toBe("identity-bridge-slug");
  });

  it("is deterministic when two files claim the same coworker", () => {
    const duplicated: PersonaTemplateIndexEntry[] = [
      { category: "specialist", slug: "zeta", declaredAgentId: "AGT-DUP" },
      { category: "route-persona", slug: "alpha", declaredAgentId: "AGT-DUP" },
    ];

    const first = resolvePersonaTemplate("AGT-DUP", duplicated);
    const second = resolvePersonaTemplate("AGT-DUP", [...duplicated].reverse());

    // Preferred category wins regardless of index order, so the coworker's job
    // cannot change between two runs.
    expect(first.ref).toEqual({ category: "route-persona", slug: "alpha" });
    expect(second.ref).toEqual(first.ref);
  });
});

describe("findDuplicateDeclarations", () => {
  it("reports nothing when every coworker's job is claimed once", () => {
    expect(findDuplicateDeclarations(index)).toEqual([]);
  });

  it("names both files when two claim the same coworker", () => {
    const duplicated: PersonaTemplateIndexEntry[] = [
      ...index,
      { category: "specialist", slug: "coo-shadow", declaredAgentId: "AGT-ORCH-000" },
    ];

    expect(findDuplicateDeclarations(duplicated)).toEqual([
      {
        declaredAgentId: "AGT-ORCH-000",
        refs: [
          { category: "route-persona", slug: "coo" },
          { category: "specialist", slug: "coo-shadow" },
        ],
      },
    ]);
  });
});
