// scripts/check-doc-anchor-existence.test.mjs
// BI-3F17B16B — the doc anchor-existence gate's logic, with the MCP HTTP
// lookups mocked (no live install required to prove the guard).
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as anchorGate from "./check-doc-anchor-existence.mjs";
import { resolveMcpCredential } from "./lib/mcp-credential.mjs";
import { startGateFixtureMcp } from "./fixtures/gate-worktree.mjs";

import {
  classifyId,
  extractAnchorIds,
  interpretToolResponse,
  isTruncatedListing,
  listChangedFiles,
  parseAnchorBaseline,
  serializeAnchorBaseline,
  verifyAnchors,
} from "./check-doc-anchor-existence.mjs";

test("explicit anchor URL and client file win over ambient legacy identity without materializing the refreshable bearer", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dpf-anchor-credential-"));
  const credentialPath = path.join(directory, "fixture-client.json");
  writeFileSync(credentialPath, JSON.stringify({ clientId: "fixture-client", clientSecret: "fixture-secret" }));
  const server = await startGateFixtureMcp(call => ({ itemId: call.args.itemId }));
  const exchanges = [];
  try {
    const connection = anchorGate.resolveDocAnchorConnection({
      DPF_MCP_URL: ` ${server.url}/api/mcp/v1?tier=full `,
      DPF_MCP_ENDPOINT: "http://127.0.0.1:1/legacy",
      DPF_MCP_CLIENT_CREDENTIALS_FILE: credentialPath,
      DPF_MCP_BEARER_TOKEN: "wrong-legacy-pat",
    }, { resolveCredential: options => resolveMcpCredential({ ...options, exchange: async args => {
      exchanges.push(args);
      return { accessToken: "fixture-token", expiresAt: Date.now() + 300000 };
    } }) });
    assert.equal(connection.endpoint, server.url + "/api/mcp/v1?tier=full");
    assert.equal(connection.bearer.kind, "client_credentials");
    assert.equal(exchanges.length, 0, "selection must preserve lazy refresh rather than cache a token string");
    const response = await anchorGate.callTool(connection.endpoint, connection.bearer, "get_backlog_item", { itemId: "BI-81AF5884" });
    assert.equal(interpretToolResponse("backlog-item", "BI-81AF5884", response), "exists");
    assert.equal(exchanges.length, 1);
    assert.equal(exchanges[0].mcpUrl, connection.endpoint);
    assert.equal(exchanges[0].clientId, "fixture-client");
    assert.equal(exchanges[0].clientSecret, "fixture-secret");
    assert.deepEqual(server.calls, [{ name: "get_backlog_item", args: { itemId: "BI-81AF5884" } }]);
  } finally { await server.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("anchor connection retains legacy fallback and does not retry malformed client configuration as another identity", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dpf-anchor-legacy-"));
  try {
    const credentialPath = path.join(directory, "absent.json");
    const env = { DPF_MCP_ENDPOINT: " http://127.0.0.1:1/legacy ", DPF_MCP_CLIENT_CREDENTIALS_FILE: credentialPath, DPF_MCP_BEARER_TOKEN: "legacy-fixture-token" };
    assert.deepEqual(anchorGate.resolveDocAnchorConnection(env), { endpoint: "http://127.0.0.1:1/legacy", bearer: "legacy-fixture-token" });
    assert.equal(anchorGate.resolveDocAnchorConnection({ ...env, DPF_MCP_ENDPOINT: " " }).endpoint, anchorGate.DEFAULT_ENDPOINT);
    writeFileSync(credentialPath, "not JSON");
    assert.throws(() => anchorGate.resolveDocAnchorConnection(env), /not valid JSON/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("authority evidence unavailable with an echoed anchor remains skipped, never verified or missing", async () => {
  const unavailable = { result: { isError: true, content: [{ type: "text", text: JSON.stringify({ success: false, error: "authority_evidence_unavailable", itemId: "BI-81AF5884", message: "The authority check is unavailable; this is not a refusal." }) }] } };
  const pair = { doc: "docs/fixture.md", id: "BI-81AF5884" };
  const result = await verifyAnchors([pair], async () => interpretToolResponse("backlog-item", pair.id, unavailable));
  assert.deepEqual(result, { missing: [], skipped: [pair], unverifiable: [], verified: [] });
});

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

// A live install with 115 epics returned only the first 100, and the plan citing
// a correctly filed epic in the tail was failed as "does NOT exist in the live
// backlog". Absence has to be proven; a short page never proves it.
test("a truncated epic catalog is not evidence that a cited epic is missing", () => {
  const truncated = JSON.stringify({
    result: { epics: [{ epicId: "EP-AAAA1111" }], total: 115, fetched: 100, truncated: true },
  });
  assert.equal(isTruncatedListing(truncated), true);
  // The listing genuinely contains no EP-5102F494, and the old guard called that
  // missing. Truncation must divert it to "unknown" before that check is reached.
  assert.equal(interpretToolResponse("epic", "EP-5102F494", truncated), "missing");
});

test("a complete epic catalog is trusted, so a real miss is still caught", () => {
  const complete = JSON.stringify({
    result: { epics: [{ epicId: "EP-AAAA1111" }], total: 1, fetched: 1, truncated: false },
  });
  assert.equal(isTruncatedListing(complete), false);
  assert.equal(interpretToolResponse("epic", "EP-AAAA1111", complete), "exists");
  assert.equal(interpretToolResponse("epic", "EP-NOTREAL0", complete), "missing");
});

test("fetched short of total counts as truncated even without the flag", () => {
  assert.equal(isTruncatedListing(JSON.stringify({ result: { total: 115, fetched: 100 } })), true);
  assert.equal(isTruncatedListing(JSON.stringify({ result: { total: 100, fetched: 100 } })), false);
});

test("an unparseable listing is never treated as a complete one", () => {
  assert.equal(isTruncatedListing("<html>gateway timeout</html>"), true);
});

// Seen live 2026-09-06: a 222-epic catalog came back from the MCP server's
// per-call context budget as a 6 KB `structuredContent._preview` naming four
// epics, with `_truncated: true` (underscore) — and every other correctly
// cited epic was declared missing.
test("the MCP server's context-budget preview (_truncated) counts as truncated", () => {
  const budgeted = JSON.stringify({
    result: {
      content: [{ type: "text", text: "{\"success\":true,\"message\":\"Listed 222 epic(s) (222 of 222 fetched)…\"}" }],
      isError: false,
      structuredContent: {
        _truncated: true,
        _note: "Result exceeded the per-call context budget; re-call with filter/pagination/range parameters to narrow it.",
        _originalChars: 132349,
        _preview: "{\"epics\":[{\"epicId\":\"EP-AAAA1111\"},{\"epicId\":\"EP-BBBB2222\"}",
      },
    },
  });
  assert.equal(isTruncatedListing(budgeted), true);
});
