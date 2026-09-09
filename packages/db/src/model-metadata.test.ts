import { describe, expect, it } from "vitest";

import {
  formatModelMetadataTag,
  parseCatalogComment,
  parseCatalogCommentWithModel,
  parseModelMetadataSource,
  parseModelMetadataSources,
  toCatalogComment,
  validateModelMetadata,
} from "./model-metadata";

const schema = `
/// Rows describing every tool invocation.
/// @dpf lifecycle=telemetry-bounded retention=365d sensitivity=internal categories=telemetry,security-audit owner=platform-architecture steward=data-steward timeAxis=createdAt
model ToolExecution {
  id String @id
  createdAt DateTime @default(now())
  @@index([createdAt])
}

/// @dpf lifecycle=regulated-record retention=retained sensitivity=confidential categories=financial basis=Financial_record_retention_(IRS_/_SOX)
model Invoice {
  id String @id
  @@map("invoices")
}

model Untagged {
  id String @id
}

/// @dpf lifecycle=operational retention=reference sensitivity=public
model Country {
  id String @id
}

model IgnoredThing {
  id String @id
  @@ignore
}
`;

describe("parseModelMetadataSource", () => {
  it("reads tags, maps tables, and lists untagged persistent models", () => {
    const parsed = parseModelMetadataSource(schema, "x.prisma");
    expect(parsed.issues).toEqual([]);
    expect(parsed.entries.map((e) => e.model)).toEqual(["ToolExecution", "Invoice", "Country"]);
    const invoice = parsed.entries.find((e) => e.model === "Invoice")!;
    expect(invoice.table).toBe("invoices");
    expect(invoice.metadata).toEqual({
      lifecycle: "regulated-record",
      retention: { kind: "retained" },
      sensitivity: "confidential",
      categories: ["financial"],
      basis: "Financial record retention (IRS / SOX)",
    });
    const tool = parsed.entries[0].metadata;
    expect(tool.retention).toEqual({ kind: "purge", days: 365 });
    expect(tool.timeAxis).toBe("createdAt");
    expect(parsed.untagged.map((u) => u.model)).toEqual(["Untagged"]);
  });

  it("rejects an unknown key, a bad vocabulary value, and a purge window without a time axis", () => {
    const bad = `
/// @dpf lifecycle=forever retention=30d colour=blue
model A { id String @id }
`;
    const parsed = parseModelMetadataSource(bad, "bad.prisma");
    expect(parsed.entries).toEqual([]);
    const messages = parsed.issues.map((i) => i.message).join("\n");
    expect(messages).toContain('unknown @dpf key "colour"');
    expect(messages).toContain('lifecycle "forever"');
    expect(messages).toContain("needs timeAxis");
  });

  it("refuses a purge window on a class the lifecycle algebra marks non-purgeable", () => {
    const { metadata, issues } = validateModelMetadata(
      [
        ["lifecycle", "regulated-record"],
        ["retention", "90d"],
        ["timeAxis", "createdAt"],
      ],
      { file: "f", line: 1, model: "M" },
    );
    expect(metadata).toBeNull();
    expect(issues[0].message).toContain("cannot carry a purge window");
  });

  it("flags a tag that is not directly above a model", () => {
    const stray = `
/// @dpf lifecycle=operational retention=config
enum Colour { RED }
model B { id String @id }
`;
    const parsed = parseModelMetadataSource(stray, "s.prisma");
    expect(parsed.issues.map((i) => i.message)).toContain("@dpf tag is not directly above a model block");
    expect(parsed.untagged.map((u) => u.model)).toEqual(["B"]);
  });

  it("reports a model declared in two files", () => {
    const parsed = parseModelMetadataSources([
      { file: "a.prisma", source: "/// @dpf lifecycle=operational retention=config\nmodel Dup { id String @id }\n" },
      { file: "b.prisma", source: "/// @dpf lifecycle=operational retention=config\nmodel Dup { id String @id }\n" },
    ]);
    expect(parsed.issues.some((i) => i.message.startsWith("model declared twice"))).toBe(true);
  });
});

describe("catalog carrier", () => {
  it("round-trips through the COMMENT ON payload and the canonical tag line", () => {
    const parsed = parseModelMetadataSource(schema, "x.prisma");
    for (const entry of parsed.entries) {
      const comment = toCatalogComment(entry.metadata, entry.model);
      expect(comment.startsWith(`dpf:{"model":"${entry.model}"`)).toBe(true);
      expect(parseCatalogComment(comment)).toEqual(entry.metadata);
      expect(parseCatalogCommentWithModel(comment)).toEqual({ model: entry.model, metadata: entry.metadata });
      const reparsed = parseModelMetadataSource(`${formatModelMetadataTag(entry.metadata)}\nmodel X { id String @id }\n`, "r.prisma");
      expect(reparsed.entries[0].metadata).toEqual(entry.metadata);
    }
  });

  it("returns null for a foreign or malformed comment", () => {
    expect(parseCatalogComment("hand-written table comment")).toBeNull();
    expect(parseCatalogComment("dpf:{not json")).toBeNull();
    expect(parseCatalogComment(null)).toBeNull();
  });
});
