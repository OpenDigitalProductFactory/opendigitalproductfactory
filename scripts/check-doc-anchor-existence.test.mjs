// scripts/check-doc-anchor-existence.test.mjs
// BI-3F17B16B — the doc anchor-existence gate's logic, with the MCP HTTP
// lookups mocked (no live install required to prove the guard).
import assert from "node:assert/strict";
import { test } from "node:test";

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyId,
  extractAnchorIds,
  interpretToolResponse,
  listChangedFiles,
  parseAnchorBaseline,
  serializeAnchorBaseline,
  verifyAnchors,
} from "./check-doc-anchor-existence.mjs";

test("extractAnchorIds finds hex-shaped EP/BI/WC (8) and DI (12) ids, deduped and sorted", () => {
  const md = [
    "Anchors: BI-3F17B16B under EP-413F2602, room WC-A843A014, ledger DI-9CA3854D4287.",
    "Repeat BI-3F17B16B. Named epics like EP-WORK-CONVERGENCE are out of scope.",
    "Lowercase bi-12345678 and short BI-1234 do not match; BI-79BCE3F2 does.",
  ].join("\n");
  assert.deepEqual(extractAnchorIds(md), [
    "BI-3F17B16B",
    "BI-79BCE3F2",
    "DI-9CA3854D4287",
    "EP-413F2602",
    "WC-A843A014",
  ]);
});

test("classifyId routes BI to get_backlog_item, EP to list_epics, WC/DI to unverifiable", () => {
  assert.equal(classifyId("BI-3F17B16B"), "backlog-item");
  assert.equal(classifyId("EP-413F2602"), "epic");
  assert.equal(classifyId("WC-A843A014"), "unverifiable");
  assert.equal(classifyId("DI-9CA3854D4287"), "unverifiable");
});

test("baseline round-trips with the budget header and skips comments", () => {
  const text = serializeAnchorBaseline(
    [
      { doc: "docs/b.md", id: "BI-79BCE3F2" },
      { doc: "docs/a.md", id: "EP-413F2602" },
      { doc: "docs/a.md", id: "EP-413F2602" }, // duplicate collapses
    ],
    { owner: "platform-architecture", expiry: "2026-11-16" },
  );
  assert.match(text, /^# owner: platform-architecture\n# expiry: 2026-11-16\n/);
  const keys = parseAnchorBaseline(text);
  assert.equal(keys.size, 2);
  assert.ok(keys.has("docs/a.md\tEP-413F2602"));
  assert.ok(keys.has("docs/b.md\tBI-79BCE3F2"));
});

test("interpretToolResponse: not_found is missing; echoed id is exists; errors are unknown", () => {
  // Real shape, captured from a live portal: a genuine miss is an ERROR RESULT
  // (`isError: true`) carrying the not_found marker. The fixture previously
  // omitted isError, which let a looser content match look correct (BI-34C7A7F8).
  const notFound = JSON.stringify({
    jsonrpc: "2.0", id: 1,
    result: {
      content: [{ type: "text", text: '{"success":false,"error":"not_found","message":"Item BI-C04CAD7F not found"}' }],
      isError: true,
    },
  });
  assert.equal(interpretToolResponse("backlog-item", "BI-C04CAD7F", notFound), "missing");

  const found = JSON.stringify({
    jsonrpc: "2.0", id: 1,
    result: { content: [{ type: "text", text: '{"success":true,"item":{"itemId":"BI-3F17B16B","title":"Budgets"}}' }] },
  });
  assert.equal(interpretToolResponse("backlog-item", "BI-3F17B16B", found), "exists");

  const rpcError = JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32001, message: "insufficient_token_scope" } });
  assert.equal(interpretToolResponse("backlog-item", "BI-3F17B16B", rpcError), "unknown");
  assert.equal(interpretToolResponse("backlog-item", "BI-3F17B16B", "<html>portal booting</html>"), "unknown");
});

test("interpretToolResponse for epics: membership in the listing decides", () => {
  const listing = JSON.stringify({
    jsonrpc: "2.0", id: 1,
    result: { content: [{ type: "text", text: '{"epics":[{"epicId":"EP-413F2602"},{"epicId":"EP-8B03CB06"}]}' }] },
  });
  assert.equal(interpretToolResponse("epic", "EP-413F2602", listing), "exists");
  assert.equal(interpretToolResponse("epic", "EP-DEADBEEF", listing), "missing");
});

test("verifyAnchors sorts pairs into missing/verified/skipped/unverifiable via the injected lookup", async () => {
  const pairs = [
    { doc: "docs/x.md", id: "BI-3F17B16B" },
    { doc: "docs/x.md", id: "BI-C04CAD7F" },
    { doc: "docs/x.md", id: "EP-413F2602" },
    { doc: "docs/x.md", id: "WC-A843A014" },
    { doc: "docs/x.md", id: "BI-0BADF00D" },
  ];
  const verdicts = {
    "BI-3F17B16B": "exists",
    "BI-C04CAD7F": "missing",
    "EP-413F2602": "exists",
    "BI-0BADF00D": "unknown",
  };
  const calls = [];
  const result = await verifyAnchors(pairs, async (kind, id) => {
    calls.push(`${kind}:${id}`);
    return verdicts[id];
  });
  assert.deepEqual(result.missing.map((p) => p.id), ["BI-C04CAD7F"]);
  assert.deepEqual(result.verified.map((p) => p.id), ["BI-3F17B16B", "EP-413F2602"]);
  assert.deepEqual(result.skipped.map((p) => p.id), ["BI-0BADF00D"]);
  assert.deepEqual(result.unverifiable.map((p) => p.id), ["WC-A843A014"]);
  // The unverifiable id never reached the lookup (no HTTP for WC-/DI-).
  assert.ok(!calls.some((c) => c.includes("WC-")));
});

// BI-34C7A7F8: the verdict must key on the ERROR RESULT, not on the words
// "not found" appearing anywhere in the payload. get_backlog_item returns the
// item's full body and every attached evidence record, and bug reports quote
// that phrase constantly — a content match declared real items missing and
// blocked commits that cited them correctly.
test("interpretToolResponse: a real item whose body quotes 'not found' still exists", () => {
  const bodyQuotesNotFound = JSON.stringify({
    jsonrpc: "2.0", id: 1,
    result: {
      content: [{
        type: "text",
        text: JSON.stringify({
          itemId: "BI-6CFC5429",
          title: "ideate agent is blind to real source",
          body: 'list_project_directory{path:"apps/web/lib/attention"} -> "Directory not found". '
            + 'Also observed: "Build not found" in the ship path.',
        }),
      }],
    },
  });
  assert.equal(interpretToolResponse("backlog-item", "BI-6CFC5429", bodyQuotesNotFound), "exists");
});

test("interpretToolResponse: an error result without not_found stays unknown, never missing", () => {
  const scopeError = JSON.stringify({
    jsonrpc: "2.0", id: 1,
    result: {
      content: [{ type: "text", text: '{"success":false,"error":"insufficient_scope"}' }],
      isError: true,
    },
  });
  assert.equal(interpretToolResponse("backlog-item", "BI-3F17B16B", scopeError), "unknown");
});

// BI-B6433DC6: "I could not compute the diff" is not "the diff was empty".
// git() used to swallow a failed `git diff origin/main...HEAD` into "" and
// main() printed "No diff against origin/main (or ref unavailable) — OK."
test("listChangedFiles: an unresolvable base is not an empty diff", () => {
  const git = (args) => {
    if (args[0] === "rev-parse") {
      return { ok: false, stdout: "", stderr: "fatal: Needed a single revision" };
    }
    return { ok: true, stdout: "" };
  };
  const result = listChangedFiles("origin/main", { git });
  assert.equal(result.status, "unresolvable");
  assert.deepEqual(result.files, []);
  assert.match(result.detail, /Needed a single revision/);
});

test("listChangedFiles: a failed git diff is unresolvable even if the ref parses", () => {
  // Shallow clones can resolve origin/main as a name and still fail the
  // three-dot diff because the merge-base is not in the truncated history.
  const git = (args) => {
    if (args[0] === "rev-parse") return { ok: true, stdout: "abc123\n" };
    return { ok: false, stdout: "", stderr: "fatal: invalid rev input" };
  };
  const result = listChangedFiles("origin/main", { git });
  assert.equal(result.status, "unresolvable");
});

test("listChangedFiles: a resolved ref with no files is empty, not unresolvable", () => {
  const git = (args) => {
    if (args[0] === "rev-parse") return { ok: true, stdout: "abc123\n" };
    return { ok: true, stdout: "" };
  };
  const result = listChangedFiles("origin/main", { git });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.files, []);
});

test("listChangedFiles: a resolved ref with files lists them", () => {
  const git = (args) => {
    if (args[0] === "rev-parse") return { ok: true, stdout: "abc123\n" };
    return { ok: true, stdout: "docs/a.md\nscripts/x.mjs\n" };
  };
  const result = listChangedFiles("origin/main", { git });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.files, ["docs/a.md", "scripts/x.mjs"]);
});

test("an unresolvable BASE_SHA must not exit 0 with OK (BI-B6433DC6)", () => {
  const script = fileURLToPath(new URL("./check-doc-anchor-existence.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    cwd: path.resolve(path.dirname(script), ".."),
    env: { ...process.env, BASE_SHA: "origin/this-ref-does-not-exist-b6433dc6" },
  });
  const out = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0, `must not exit 0 when the base ref is missing; output:\n${out}`);
  assert.doesNotMatch(out, /\bOK\.\s*$/m);
  assert.match(out, /cannot resolve|did not run/i);
  assert.match(out, /git fetch --deepen/);
});
