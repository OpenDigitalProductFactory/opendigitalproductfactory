import { describe, expect, it } from "vitest";

import {
  buildListTrackedFilesCommand,
  shouldIndexCodeGraphPath,
} from "./path-filter";

describe("shouldIndexCodeGraphPath", () => {
  it("allows DPF source, schema, prompt, and doc extensions", () => {
    expect(shouldIndexCodeGraphPath("apps/web/lib/mcp-tools.ts")).toBe(true);
    expect(shouldIndexCodeGraphPath("apps/web/app/build/page.tsx")).toBe(true);
    expect(shouldIndexCodeGraphPath("packages/db/prisma/schema.prisma")).toBe(true);
    expect(shouldIndexCodeGraphPath("docs/superpowers/specs/example.md")).toBe(true);
  });

  it("rejects unsupported binary and generated file extensions", () => {
    expect(shouldIndexCodeGraphPath("apps/web/public/logo.png")).toBe(false);
    expect(shouldIndexCodeGraphPath("apps/web/.next/build-manifest.js")).toBe(false);
    expect(shouldIndexCodeGraphPath("packages/db/generated/client/index.d.ts")).toBe(false);
    expect(shouldIndexCodeGraphPath("node_modules/pkg/index.ts")).toBe(false);
  });
});

describe("buildListTrackedFilesCommand", () => {
  it("includes source extensions and excludes generated dependency folders", () => {
    const command = buildListTrackedFilesCommand();

    expect(command).toContain("git ls-files --");
    expect(command).toContain('"**/*.ts"');
    expect(command).toContain('":(exclude)**/node_modules/**"');
    expect(command).toContain('":(exclude)**/.next/**"');
    expect(command).toContain('":(exclude)packages/db/generated/**"');
  });
});
