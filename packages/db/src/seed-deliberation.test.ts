import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  discoverDeliberationFiles,
  parseDeliberationFile,
  parseDeliberationContent,
  applyDeliberationPatterns,
  type DeliberationFrontmatter,
  type DeliberationRecord,
} from "./seed-deliberation";

describe("seed-deliberation parseFrontmatter", () => {
  it("parses scalar fields and block arrays of objects (defaultRoles)", () => {
    const raw = `---
slug: review
name: Peer Review
status: active
purpose: Structured multi-agent critique before a normal HITL gate.
defaultRoles:
  - roleId: author
    count: 1
    required: true
  - roleId: reviewer
    count: 2
    required: true
  - roleId: adjudicator
    count: 1
    required: true
topologyTemplate:
  rootNodeType: review
  branchNodeType: review
  skepticalNodeType: skeptical_review
  edgeTypes: ["informs"]
---

Body text.`;

    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.slug).toBe("review");
    expect(frontmatter.name).toBe("Peer Review");
    expect(frontmatter.status).toBe("active");
    expect(frontmatter.purpose).toBe(
      "Structured multi-agent critique before a normal HITL gate.",
    );
    expect(Array.isArray(frontmatter.defaultRoles)).toBe(true);
    expect(frontmatter.defaultRoles).toHaveLength(3);
    expect(frontmatter.defaultRoles[0]).toEqual({
      roleId: "author",
      count: 1,
      required: true,
    });
    expect(frontmatter.defaultRoles[1]).toEqual({
      roleId: "reviewer",
      count: 2,
      required: true,
    });
    // Nested mapping
    expect(frontmatter.topologyTemplate).toEqual({
      rootNodeType: "review",
      branchNodeType: "review",
      skepticalNodeType: "skeptical_review",
      edgeTypes: ["informs"],
    });
    expect(body).toBe("Body text.");
  });

  it("normalizes CRLF line endings", () => {
    const raw = [
      "---",
      "slug: debate",
      "name: Debate",
      "status: active",
      "purpose: Two sides defending opposed positions.",
      "---",
      "",
      "Body.",
    ].join("\r\n");

    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.slug).toBe("debate");
    expect(frontmatter.name).toBe("Debate");
  });
});

describe("seed-deliberation discoverDeliberationFiles", () => {
  it("discovers .deliberation.md files under repo-root deliberation/", () => {
    const files = discoverDeliberationFiles();
    expect(Array.isArray(files)).toBe(true);
    const slugs = files.map((f) => f.slug).sort();
    expect(slugs).toContain("review");
    expect(slugs).toContain("debate");
    for (const f of files) {
      expect(f.filePath.endsWith(".deliberation.md")).toBe(true);
    }
  });

  it("parses each discovered file into the expected record shape", () => {
    const files = discoverDeliberationFiles();
    const review = files.find((f) => f.slug === "review");
    expect(review).toBeDefined();
    const parsed = parseDeliberationFile(review!.filePath);
    expect(parsed.slug).toBe("review");
    expect(parsed.name).toBeTruthy();
    expect(parsed.purpose).toBeTruthy();
    expect(Array.isArray(parsed.defaultRoles)).toBe(true);
    expect(parsed.defaultRoles.length).toBeGreaterThan(0);
    expect(typeof parsed.topologyTemplate).toBe("object");
    expect(parsed.status).toBe("active");
    // Keys expected on the parsed record (may default to empty objects/arrays when
    // absent from the file but must be present so downstream consumers are stable).
    expect(parsed).toHaveProperty("activationPolicyHints");
    expect(parsed).toHaveProperty("evidenceRequirements");
    expect(parsed).toHaveProperty("outputContract");
    expect(parsed).toHaveProperty("providerStrategyHints");
  });
});

describe("seed-deliberation applyDeliberationPatterns (upsert + override skip)", () => {
  function makeRecord(overrides: Partial<DeliberationRecord> = {}): DeliberationRecord {
    return {
      slug: "review",
      name: "Peer Review",
      purpose: "Structured multi-agent critique before a normal HITL gate.",
      defaultRoles: [{ roleId: "author", count: 1, required: true }],
      topologyTemplate: { rootNodeType: "review" },
      activationPolicyHints: {},
      evidenceRequirements: {},
      outputContract: {},
      providerStrategyHints: {},
      status: "active",
      sourceFile: "deliberation/review.deliberation.md",
      ...overrides,
    };
  }

  it("creates a new pattern when no DB row exists", async () => {
    const creates: DeliberationRecord[] = [];
    const updates: DeliberationRecord[] = [];
    const skipped: string[] = [];

    await applyDeliberationPatterns({
      records: [makeRecord()],
      getExisting: async () => null,
      create: async (r) => {
        creates.push(r);
      },
      update: async (r) => {
        updates.push(r);
      },
      onSkip: (slug) => skipped.push(slug),
    });

    expect(creates).toHaveLength(1);
    expect(creates[0].slug).toBe("review");
    expect(updates).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });

  it("updates an existing non-overridden pattern from the file", async () => {
    const creates: DeliberationRecord[] = [];
    const updates: DeliberationRecord[] = [];
    const skipped: string[] = [];

    await applyDeliberationPatterns({
      records: [makeRecord({ name: "Updated Peer Review" })],
      getExisting: async (slug) => ({ slug, isOverridden: false }),
      create: async (r) => {
        creates.push(r);
      },
      update: async (r) => {
        updates.push(r);
      },
      onSkip: (slug) => skipped.push(slug),
    });

    expect(creates).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].name).toBe("Updated Peer Review");
    expect(skipped).toHaveLength(0);
  });

  it("skips rows where admin has set isOverridden=true", async () => {
    const creates: DeliberationRecord[] = [];
    const updates: DeliberationRecord[] = [];
    const skipped: string[] = [];

    await applyDeliberationPatterns({
      records: [makeRecord()],
      getExisting: async (slug) => ({ slug, isOverridden: true }),
      create: async (r) => {
        creates.push(r);
      },
      update: async (r) => {
        updates.push(r);
      },
      onSkip: (slug) => skipped.push(slug),
    });

    expect(creates).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(skipped).toEqual(["review"]);
  });
});

describe("seed-deliberation parseDeliberationContent (malformed frontmatter)", () => {
  const VIRTUAL_PATH = "deliberation/virtual.deliberation.md";

  it("throws when slug is missing", () => {
    const raw = `---
name: Peer Review
status: active
purpose: Structured multi-agent critique.
defaultRoles:
  - roleId: author
    count: 1
    required: true
topologyTemplate:
  rootNodeType: review
---

Body.`;
    expect(() => parseDeliberationContent(raw, VIRTUAL_PATH)).toThrow(/slug/);
    expect(() => parseDeliberationContent(raw, VIRTUAL_PATH)).toThrow(
      VIRTUAL_PATH,
    );
  });

  it("throws when defaultRoles is missing", () => {
    const raw = `---
slug: review
name: Peer Review
status: active
purpose: Structured multi-agent critique.
topologyTemplate:
  rootNodeType: review
---

Body.`;
    expect(() => parseDeliberationContent(raw, VIRTUAL_PATH)).toThrow(
      /defaultRoles/,
    );
    expect(() => parseDeliberationContent(raw, VIRTUAL_PATH)).toThrow(
      VIRTUAL_PATH,
    );
  });

  it("throws when defaultRoles is an empty array", () => {
    const raw = `---
slug: review
name: Peer Review
status: active
purpose: Structured multi-agent critique.
defaultRoles: []
topologyTemplate:
  rootNodeType: review
---

Body.`;
    expect(() => parseDeliberationContent(raw, VIRTUAL_PATH)).toThrow(
      /defaultRoles/,
    );
  });

  it("throws when a defaultRoles item is missing roleId", () => {
    const raw = `---
slug: review
name: Peer Review
status: active
purpose: Structured multi-agent critique.
defaultRoles:
  - count: 1
    required: true
topologyTemplate:
  rootNodeType: review
---

Body.`;
    expect(() => parseDeliberationContent(raw, VIRTUAL_PATH)).toThrow(
      /defaultRoles\[0\]\.roleId/,
    );
    expect(() => parseDeliberationContent(raw, VIRTUAL_PATH)).toThrow(
      VIRTUAL_PATH,
    );
  });
});
