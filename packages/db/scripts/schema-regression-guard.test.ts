// Tests for schema-regression-guard.mjs. The script and the test live next
// to each other in packages/db/scripts/. Tests target the parser and diff
// logic directly — the CLI wrapper is small and exercised in CI.
//
// What this proves:
//   - Adding a field/attribute/model/enum-value: no regression
//   - Widening a required field/relation to optional: no regression
//   - Removing a field/attribute/model/enum-value: regression
//   - Changing a field type to a different type: regression
//   - Reordering attributes within a model (the PR #1366 false-positive
//     case): no regression
//   - Whitespace / column-alignment changes (the other formatter quirk):
//     no regression

import { describe, expect, it } from "vitest";

import { diffSchemas, parseSchema } from "./schema-regression-guard.mjs";

// A minimal schema we can mutate per-test. Kept narrow so the diffs are easy
// to reason about; real schema.prisma is thousands of lines but the algorithm
// is the same.
const BASE = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Widget {
  id        String   @id @default(cuid())
  name      String
  ownerId   String?
  createdAt DateTime @default(now())

  @@index([ownerId])
  @@unique([name, ownerId])
  @@index([createdAt(sort: Desc)])
}

enum WidgetStatus {
  draft
  active
  archived
}
`;

function regressions(base: string, head: string) {
  return diffSchemas(parseSchema(base), parseSchema(head));
}

describe("schema-regression-guard", () => {
  it("flags nothing when nothing changes", () => {
    expect(regressions(BASE, BASE)).toEqual([]);
  });

  it("tolerates within-model attribute reorder (PR #1366 case)", () => {
    // Same model, attributes shuffled — prisma format does this across
    // formatter versions. Set semantics should treat this as a no-op.
    const reordered = BASE.replace(
      `  @@index([ownerId])
  @@unique([name, ownerId])
  @@index([createdAt(sort: Desc)])`,
      `  @@unique([name, ownerId])
  @@index([ownerId])
  @@index([createdAt(sort: Desc)])`,
    );
    expect(regressions(BASE, reordered)).toEqual([]);
  });

  it("tolerates whitespace / column-alignment changes", () => {
    // Replace double-space column alignment with single spaces. Same content.
    const reformatted = BASE.replace(
      /id        String/,
      "id String",
    ).replace(
      /createdAt DateTime @default\(now\(\)\)/,
      "createdAt   DateTime   @default(now())",
    );
    expect(regressions(BASE, reformatted)).toEqual([]);
  });

  it("tolerates trailing-comment changes", () => {
    const withComments = BASE.replace(
      /name      String/,
      "name      String  // user-facing display name",
    );
    expect(regressions(BASE, withComments)).toEqual([]);
  });

  it("passes when a field is added", () => {
    const added = BASE.replace(
      /createdAt DateTime @default\(now\(\)\)/,
      `createdAt DateTime @default(now())
  description String?`,
    );
    expect(regressions(BASE, added)).toEqual([]);
  });

  it("passes when a required field is widened to optional", () => {
    const before = BASE.replace(/ownerId   String\?/, "ownerId   String");
    expect(regressions(before, BASE)).toEqual([]);
  });

  it("tolerates a column default-value change (not a removal)", () => {
    // Changing @default only affects new inserts, never existing rows —
    // e.g. retiring a GBP-by-default bias to USD (EP-ORG-LOCALE-CURRENCY).
    const withDefault = BASE.replace(
      /name      String/,
      'name      String   @default("GBP")',
    );
    const flipped = BASE.replace(
      /name      String/,
      'name      String   @default("USD")',
    );
    expect(regressions(withDefault, flipped)).toEqual([]);
  });

  it("still flags a field removal even when another field's default changed", () => {
    const withDefault = BASE.replace(
      /name      String/,
      'name      String   @default("GBP")',
    );
    const flippedAndDropped = BASE
      .replace(/name      String/, 'name      String   @default("USD")')
      .replace(/  ownerId   String\?\n/, "");
    const found = regressions(withDefault, flippedAndDropped);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/ownerId/);
  });

  it("passes when a required relation field is widened to optional", () => {
    const before = `
model SupplierContract {
  id        String @id @default(cuid())
  profileId String
  profile   AiProviderFinanceProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
}

model AiProviderFinanceProfile {
  id        String @id @default(cuid())
  contracts SupplierContract[]
}
`;
    const after = before
      .replace("profileId String", "profileId String?")
      .replace("profile   AiProviderFinanceProfile @relation", "profile   AiProviderFinanceProfile? @relation");
    expect(regressions(before, after)).toEqual([]);
  });

  it("flags a removed field", () => {
    const dropped = BASE.replace(/  ownerId   String\?\n/, "");
    const found = regressions(BASE, dropped);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/model Widget: removed/);
    expect(found[0]).toMatch(/ownerId/);
  });

  it("skips a field removal on the intentional-removal allowlist", () => {
    const dropped = BASE.replace(/  ownerId   String\?\n/, "");
    const found = diffSchemas(parseSchema(BASE), parseSchema(dropped), new Set(["Widget.ownerId"]));
    expect(found).toEqual([]);
  });

  it("still flags a non-allowlisted removal when an allowlist is in effect", () => {
    const dropped = BASE.replace(/  ownerId   String\?\n/, "");
    const found = diffSchemas(parseSchema(BASE), parseSchema(dropped), new Set(["Widget.somethingElse"]));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/ownerId/);
  });

  it("flags a changed field type", () => {
    const changed = BASE.replace(/name      String/, "name      Int");
    const found = regressions(BASE, changed);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/model Widget: removed `name String`/);
  });

  it("flags a removed attribute", () => {
    const dropped = BASE.replace(/  @@unique\(\[name, ownerId\]\)\n/, "");
    const found = regressions(BASE, dropped);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/@@unique/);
  });

  it("allows only an exact steward-reviewed model attribute removal", () => {
    const dropped = BASE.replace(/  @@unique\(\[name, ownerId\]\)\n/, "");
    const exact = new Set(["Widget.@@unique([name, ownerId])"]);
    expect(diffSchemas(parseSchema(BASE), parseSchema(dropped), new Set(), new Map(), exact)).toEqual([]);
    expect(diffSchemas(parseSchema(BASE), parseSchema(dropped), new Set(), new Map(), new Set(["Widget.@@index([name])"])))
      .toEqual(["model Widget: removed `@@unique([name, ownerId])`"]);
  });

  it("flags a removed model entirely", () => {
    const dropped = BASE.replace(/model Widget \{[\s\S]*?\n\}\n/, "");
    const found = regressions(BASE, dropped);
    expect(found).toEqual(["model Widget removed entirely"]);
  });

  it("flags a removed enum value", () => {
    const dropped = BASE.replace(/  archived\n/, "");
    const found = regressions(BASE, dropped);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/enum WidgetStatus: removed value `archived`/);
  });

  it("flags a removed enum entirely", () => {
    const dropped = BASE.replace(/enum WidgetStatus \{[\s\S]*?\n\}\n/, "");
    const found = regressions(BASE, dropped);
    expect(found).toEqual(["enum WidgetStatus removed entirely"]);
  });

  it("flags multiple regressions in one diff", () => {
    const broken = BASE.replace(/  ownerId   String\?\n/, "").replace(
      /  archived\n/,
      "",
    );
    const found = regressions(BASE, broken);
    expect(found).toHaveLength(2);
  });

  it("ignores top-level (datasource/generator) changes", () => {
    // The guard is scoped to model + enum bodies. Datasource block changes
    // don't surface as regressions — they're reviewed through a different
    // channel.
    const datasourceChanged = BASE.replace(
      /provider = "postgresql"/,
      'provider = "mysql"',
    );
    expect(regressions(BASE, datasourceChanged)).toEqual([]);
  });

  it("reproduces the PR #1366 PlatformIssueReport reorder as a no-op", () => {
    // Smoke-test the exact reorder shape that tripped the original
    // awk-based guard. The @@unique line moved from a different index in
    // the constraint block; everything else is identical.
    const before = `
model PlatformIssueReport {
  id           String  @id @default(cuid())
  reportedById String?

  @@index([featureBuildId])
  @@index([threadId, createdAt(sort: Desc)])
  @@index([taskRunId])
  @@unique([reportedById, supportSessionId])
  @@index([reportedById, supportSessionId, createdAt(sort: Desc)])
}
`;
    const after = `
model PlatformIssueReport {
  id           String  @id @default(cuid())
  reportedById String?

  @@unique([reportedById, supportSessionId])
  @@index([featureBuildId])
  @@index([threadId, createdAt(sort: Desc)])
  @@index([taskRunId])
  @@index([reportedById, supportSessionId, createdAt(sort: Desc)])
}
`;
    expect(regressions(before, after)).toEqual([]);
  });
});

// ─── Sanctioned model renames ────────────────────────────────────────────────
//
// A logical model rename is not a regression WHEN the physical table is
// preserved via @@map. Without the @@map the rename really does drop the
// table, so the guard must still block it. That asymmetry is the whole safety
// property of the rename allowlist.
describe("intentional model renames", () => {
  const RENAMES = new Map([["OldThing", "NewThing"]]);
  const base = parseSchema(`
model OldThing {
  id    String @id
  name  String
  kids  OldKid[]
}

model Holder {
  id      String   @id
  thingId String?
  thing   OldThing? @relation(fields: [thingId], references: [id])
}
`);

  it("accepts a rename that preserves the physical table via @@map", () => {
    const head = parseSchema(`
model NewThing {
  id    String @id
  name  String
  kids  OldKid[]
  @@map("OldThing")
}

model Holder {
  id      String   @id
  thingId String?
  thing   NewThing? @relation(fields: [thingId], references: [id])
}
`);
    expect(diffSchemas(base, head, new Set(), RENAMES)).toEqual([]);
  });

  it("still blocks a rename that does NOT preserve the table", () => {
    const head = parseSchema(`
model NewThing {
  id    String @id
  name  String
  kids  OldKid[]
}

model Holder {
  id      String   @id
  thingId String?
  thing   NewThing? @relation(fields: [thingId], references: [id])
}
`);
    const regressions = diffSchemas(base, head, new Set(), RENAMES);
    expect(regressions).toContain("model OldThing removed entirely");
  });

  // Regression: once the rename has SHIPPED, base already contains the new model
  // carrying @@map("<old name>"). The rename substitution used to rewrite inside
  // that directive — turning base's @@map("OldThing") into @@map("NewThing"),
  // which never matches head — so every renamed model reported its own @@map as
  // removed and main regressed against itself. The @@map argument is a physical
  // table name and must never be substituted.
  it("reports nothing when base ALREADY carries the shipped rename", () => {
    const shipped = parseSchema(`
model NewThing {
  id    String @id
  name  String
  kids  OldKid[]
  @@map("OldThing")
}

model Holder {
  id      String   @id
  thingId String?
  thing   NewThing? @relation(fields: [thingId], references: [id])
}
`);
    expect(diffSchemas(shipped, shipped, new Set(), RENAMES)).toEqual([]);
  });

  it("still reports a genuine field drop inside a renamed model", () => {
    const head = parseSchema(`
model NewThing {
  id    String @id
  kids  OldKid[]
  @@map("OldThing")
}

model Holder {
  id      String   @id
  thingId String?
  thing   NewThing? @relation(fields: [thingId], references: [id])
}
`);
    const regressions = diffSchemas(base, head, new Set(), RENAMES);
    expect(regressions.some((r) => r.includes("name String"))).toBe(true);
    expect(regressions.some((r) => r.includes("renamed to NewThing"))).toBe(true);
  });

  it("blocks an unlisted model removal even while renames are configured", () => {
    const head = parseSchema(`
model NewThing {
  id    String @id
  name  String
  kids  OldKid[]
  @@map("OldThing")
}
`);
    const regressions = diffSchemas(base, head, new Set(), RENAMES);
    expect(regressions).toContain("model Holder removed entirely");
  });
});
