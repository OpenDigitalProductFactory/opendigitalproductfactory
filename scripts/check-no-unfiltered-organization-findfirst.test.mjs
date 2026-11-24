import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareToBaseline, findUnfilteredCalls } from "./check-no-unfiltered-organization-findfirst.mjs";

describe("findUnfilteredCalls", () => {
  it("flags an unfiltered call with or without arguments", () => {
    const body = [
      "const a = await prisma.organization.findFirst();",
      "const b = await prisma.organization.findFirst({ select: { id: true } });",
    ].join("\n");
    assert.deepEqual(findUnfilteredCalls(body).map((h) => h.line), [1, 2]);
  });

  it("passes a call that filters", () => {
    assert.deepEqual(findUnfilteredCalls("await prisma.organization.findFirst({ where: { slug }, select: { id: true } });"), []);
  });

  it("reads a call spread over several lines", () => {
    const body = [
      "const org = await tx.organization.findFirst({",
      "  select: { id: true, name: true },",
      "  orderBy: { createdAt: \"asc\" },",
      "});",
      "const other = await db.organization.findFirst({",
      "  select: { id: true },",
      "  where: { orgId },",
      "});",
    ].join("\n");
    assert.deepEqual(findUnfilteredCalls(body).map((h) => h.line), [1]);
  });

  it("ignores comments and other models", () => {
    const body = [
      "// prisma.organization.findFirst() used to live here",
      "await prisma.customerAccount.findFirst();",
    ].join("\n");
    assert.deepEqual(findUnfilteredCalls(body), []);
  });
});

describe("compareToBaseline", () => {
  it("fails growth, including a new file", () => {
    const { grown } = compareToBaseline({ "a.ts": 2, "b.ts": 1 }, { "a.ts": 1 });
    assert.deepEqual(grown.map((g) => g.file), ["a.ts", "b.ts"]);
  });

  it("reports shrinkage, including a file that no longer has any", () => {
    const { grown, shrunk } = compareToBaseline({ "a.ts": 1 }, { "a.ts": 2, "c.ts": 1 });
    assert.deepEqual(grown, []);
    assert.deepEqual(shrunk.map((s) => s.file), ["a.ts", "c.ts"]);
  });

  it("is quiet when counts match", () => {
    assert.deepEqual(compareToBaseline({ "a.ts": 1 }, { "a.ts": 1 }), { grown: [], shrunk: [] });
  });
});
