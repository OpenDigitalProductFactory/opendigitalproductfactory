// Self-test for the bundle-boundary guard (BI-98AF1066).
//
// Check 2b is the one with real teeth and real false-positive risk, so it is
// what this file exercises: a client component that REACHES a Node built-in
// through other modules. The motivating regression is PR #4483 — a workspace
// panel imported one label out of a module that read installer state, which
// failed the production build with "the chunking context does not support
// external modules (request: node:fs/promises)" while typecheck and 24k unit
// tests stayed green.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  TRANSITIVE_FATAL_BUILTINS,
  extractStaticImports,
  fatalBuiltinChain,
  isUseClient,
  isUseServer,
} from "./check-bundle-boundaries.mjs";

/** Write a throwaway module tree and return a resolver for its files. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "dpf-bundle-guard-"));
  for (const [name, body] of Object.entries(files)) {
    const full = join(root, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body, "utf8");
  }
  return { root, path: (name) => join(root, name), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("isUseServer detects the directive after leading comments", () => {
  assert.ok(isUseServer('// header\n\n"use server";\nexport async function a() {}'));
  assert.ok(isUseServer("'use server'"));
  assert.equal(isUseServer('export const a = "use server";'), false);
});

test("isUseClient and isUseServer do not confuse each other", () => {
  assert.ok(isUseClient('"use client";'));
  assert.equal(isUseServer('"use client";'), false);
  assert.equal(isUseClient('"use server";'), false);
});

test("extractStaticImports ignores type-only imports", () => {
  const specs = extractStaticImports(
    'import type { A } from "./a";\nimport { b } from "./b";\n',
  );
  assert.deepEqual(specs, ["./b"]);
});

test("extractStaticImports keeps a mixed import, because its value half is bundled", () => {
  const specs = extractStaticImports('import { b, type A } from "./b";');
  assert.deepEqual(specs, ["./b"]);
});

test("TRANSITIVE_FATAL_BUILTINS covers fs but not the polyfillable ones", () => {
  // Narrower than check 2 on purpose: crypto/path/stream are reached all over
  // the portal today and Turbopack shims them, so failing those would be a
  // migration rather than a guard.
  assert.ok(TRANSITIVE_FATAL_BUILTINS.has("fs/promises"));
  assert.ok(TRANSITIVE_FATAL_BUILTINS.has("child_process"));
  assert.equal(TRANSITIVE_FATAL_BUILTINS.has("crypto"), false);
  assert.equal(TRANSITIVE_FATAL_BUILTINS.has("path"), false);
});

test("fatalBuiltinChain reports the full path from client component to built-in", () => {
  const f = fixture({
    "panel.tsx": '"use client";\nimport { LABEL } from "./view";\nexport const P = LABEL;\n',
    "view.ts": 'import { read } from "./io";\nexport const LABEL = read;\n',
    "io.ts": 'import { readFile } from "node:fs/promises";\nexport const read = readFile;\n',
  });
  try {
    const chain = fatalBuiltinChain(f.path("panel.tsx"));
    assert.ok(chain, "expected the guard to reach node:fs/promises");
    assert.equal(chain.at(-1), "node:fs/promises");
    assert.equal(chain.length, 3, `expected view -> io -> builtin, got ${JSON.stringify(chain)}`);
    assert.match(chain[0], /view\.ts$/);
    assert.match(chain[1], /io\.ts$/);
  } finally {
    f.cleanup();
  }
});

test("fatalBuiltinChain stops at a 'use server' module, which is an RPC boundary", () => {
  // A client component importing a server action that imports Prisma is
  // CORRECT: Next replaces the import with an RPC reference and never bundles
  // that graph. Flagging it would make the guard unusable.
  const f = fixture({
    "panel.tsx": '"use client";\nimport { save } from "./actions";\nexport const P = save;\n',
    "actions.ts": '"use server";\nimport { readFile } from "node:fs/promises";\nexport async function save() { return readFile; }\n',
  });
  try {
    assert.equal(fatalBuiltinChain(f.path("panel.tsx")), null);
  } finally {
    f.cleanup();
  }
});

test("fatalBuiltinChain does not follow a type-only import", () => {
  const f = fixture({
    "panel.tsx": '"use client";\nimport type { T } from "./io";\nexport const P: T | null = null;\n',
    "io.ts": 'import { readFile } from "node:fs/promises";\nexport type T = typeof readFile;\n',
  });
  try {
    assert.equal(fatalBuiltinChain(f.path("panel.tsx")), null);
  } finally {
    f.cleanup();
  }
});

test("fatalBuiltinChain terminates on an import cycle", () => {
  const f = fixture({
    "panel.tsx": '"use client";\nimport { a } from "./a";\nexport const P = a;\n',
    "a.ts": 'import { b } from "./b";\nexport const a = b;\n',
    "b.ts": 'import { a } from "./a";\nexport const b = a;\n',
  });
  try {
    assert.equal(fatalBuiltinChain(f.path("panel.tsx")), null);
  } finally {
    f.cleanup();
  }
});

test("fatalBuiltinChain finds a built-in past a cycle", () => {
  const f = fixture({
    "panel.tsx": '"use client";\nimport { a } from "./a";\nexport const P = a;\n',
    "a.ts": 'import { b } from "./b";\nimport { c } from "./c";\nexport const a = [b, c];\n',
    "b.ts": 'import { a } from "./a";\nexport const b = a;\n',
    "c.ts": 'import { readFile } from "node:fs/promises";\nexport const c = readFile;\n',
  });
  try {
    const chain = fatalBuiltinChain(f.path("panel.tsx"));
    assert.ok(chain, "a cycle on one branch must not hide a built-in on another");
    assert.equal(chain.at(-1), "node:fs/promises");
  } finally {
    f.cleanup();
  }
});

test("fatalBuiltinChain is quiet for a genuinely pure client graph", () => {
  const f = fixture({
    "panel.tsx": '"use client";\nimport { LABEL } from "./presentation";\nexport const P = LABEL;\n',
    "presentation.ts": 'export const LABEL = "Production";\n',
  });
  try {
    assert.equal(fatalBuiltinChain(f.path("panel.tsx")), null);
  } finally {
    f.cleanup();
  }
});
