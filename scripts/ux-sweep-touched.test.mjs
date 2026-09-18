import { test } from "node:test";
import assert from "node:assert/strict";

import { ancestorLayouts, touchedRoutes } from "./ux-sweep-touched.mjs";
import { resolveLocalImport } from "./check-no-server-imports-in-client.mjs";

const fixture = {
  "apps/web/app/layout.tsx": `import "./globals.css";\nexport default function L(){}`,
  "apps/web/app/(shell)/layout.tsx": `import { Shell } from "@/components/Shell";\n`,
  "apps/web/components/Shell.tsx": `export const Shell = 1;`,
  "apps/web/app/(shell)/workspace/rescue/care/page.tsx": `import { DailyCareOperations } from "@/components/animal-welfare/DailyCareOperations";\n`,
  "apps/web/components/animal-welfare/DailyCareOperations.tsx": `"use client";\nimport { LABELS } from "@/lib/animal-welfare/daily-care-vocabulary";\n`,
  "apps/web/lib/animal-welfare/daily-care-vocabulary.ts": `export const LABELS = {};`,
  "apps/web/app/(shell)/workspace/inbox/page.tsx": `import { Inbox } from "@/components/Inbox";\n`,
  "apps/web/components/Inbox.tsx": `export const Inbox = 1;`,
};
const read = (f) => fixture[f] ?? null;
const exists = (p) => p in fixture;
const resolveImport = (from, spec) => resolveLocalImport(from, spec, { exists });
const routes = [
  { routePath: "/workspace/rescue/care", kind: "page", file: "apps/web/app/(shell)/workspace/rescue/care/page.tsx", dynamicParams: [] },
  { routePath: "/workspace/inbox", kind: "page", file: "apps/web/app/(shell)/workspace/inbox/page.tsx", dynamicParams: [] },
  { routePath: "/api/x", kind: "route", file: "apps/web/app/api/x/route.ts", dynamicParams: [] },
];

test("ancestorLayouts lists layouts nearest first up to the app root", () => {
  assert.deepEqual(ancestorLayouts("apps/web/app/(shell)/workspace/rescue/care/page.tsx", exists), ["apps/web/app/(shell)/layout.tsx", "apps/web/app/layout.tsx"]);
});

test("a vocabulary edit maps to the one route that renders it, through the client component", () => {
  const hits = touchedRoutes(["apps/web/lib/animal-welfare/daily-care-vocabulary.ts"], routes, { read, resolveImport, exists });
  assert.deepEqual(hits.map((h) => h.routePath), ["/workspace/rescue/care"]);
  assert.deepEqual(hits[0].via, ["apps/web/lib/animal-welfare/daily-care-vocabulary.ts"]);
});

test("a shared shell layout edit maps to every page beneath it, and API routes never appear", () => {
  const hits = touchedRoutes(["apps/web/components/Shell.tsx"], routes, { read, resolveImport, exists });
  assert.deepEqual(hits.map((h) => h.routePath), ["/workspace/inbox", "/workspace/rescue/care"]);
});
