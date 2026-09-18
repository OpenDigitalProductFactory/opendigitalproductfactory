import { test } from "node:test";
import assert from "node:assert/strict";

import {
  affectedClientModules,
  directiveOf,
  findServerImportChain,
  resolveLocalImport,
  valueImportSpecifiers,
} from "./check-no-server-imports-in-client.mjs";

const fixture = {
  "apps/web/components/x/Ops.tsx": `"use client";\nimport { LABELS } from "@/lib/x/daily-care";\nimport type { Row } from "@/lib/x/daily-care";\nimport { act } from "@/app/x/actions";\n`,
  "apps/web/lib/x/daily-care.ts": `import { prisma } from "@dpf/db";\nexport const LABELS = {};\n`,
  "apps/web/app/x/actions.ts": `"use server";\nimport { prisma } from "@dpf/db";\nexport async function act() {}\n`,
  "apps/web/components/x/Safe.tsx": `// header\n"use client";\nimport { LABELS } from "./vocabulary";\n`,
  "apps/web/components/x/vocabulary.ts": `export const LABELS = {};\n`,
  "apps/web/lib/x/server-thing.server.ts": `export const s = 1;\n`,
  "apps/web/components/x/ViaServerName.tsx": `"use client";\nimport { s } from "../../lib/x/server-thing.server";\n`,
};
const read = (f) => fixture[f] ?? null;
const resolveImport = (from, spec) => resolveLocalImport(from, spec, { exists: (p) => p in fixture });

test("directiveOf reads a leading directive even after a comment; valueImportSpecifiers skips type-only imports", () => {
  assert.equal(directiveOf(fixture["apps/web/components/x/Safe.tsx"]), "use client");
  assert.equal(directiveOf(fixture["apps/web/lib/x/daily-care.ts"]), null);
  assert.deepEqual(valueImportSpecifiers(fixture["apps/web/components/x/Ops.tsx"]), ["@/lib/x/daily-care", "@/app/x/actions"]);
});

test("a client component that reaches @dpf/db through a lib module is reported with its chain", () => {
  const found = findServerImportChain("apps/web/components/x/Ops.tsx", { read, resolveImport });
  assert.deepEqual(found, { chain: ["apps/web/components/x/Ops.tsx", "apps/web/lib/x/daily-care.ts"], specifier: "@dpf/db" });
});

test("a 'use server' action module ends the walk cleanly; a *.server.ts module is server by name", () => {
  const safe = findServerImportChain("apps/web/components/x/Safe.tsx", { read, resolveImport });
  assert.equal(safe, null);
  const byName = findServerImportChain("apps/web/components/x/ViaServerName.tsx", { read, resolveImport });
  assert.equal(byName.specifier, "apps/web/lib/x/server-thing.server.ts");
});

test("affectedClientModules includes changed client files and client files importing a changed module", () => {
  const all = Object.keys(fixture);
  assert.deepEqual(affectedClientModules(["apps/web/lib/x/daily-care.ts"], { allSources: all, read, resolveImport }), ["apps/web/components/x/Ops.tsx"]);
  assert.deepEqual(affectedClientModules(["apps/web/components/x/Safe.tsx"], { allSources: all, read, resolveImport }), ["apps/web/components/x/Safe.tsx"]);
  assert.deepEqual(affectedClientModules(["apps/web/lib/unrelated.ts"], { allSources: all, read, resolveImport }), []);
});
