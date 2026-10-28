// A reaper that cannot ask who is working must not decide that nobody is.
//
// These pin the two properties that failed on 2026-09-02, when 132 worktrees
// were classified reapable and 24 of them belonged to active Workrooms: the
// claim record must be consulted, and an unreadable claim record must fail SAFE.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseActiveWorktreePaths,
  loadActiveWorkroomPaths,
  pathHasActiveClaim,
  normalizePath,
  ACTIVE_WORKROOM_STATUSES,
} from "./worktree-liveness.mjs";

const roomsPayload = (rooms) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify({ workrooms: rooms, total: rooms.length, truncated: false }) }] },
  });

const pagePayload = (rooms, extra = {}) => JSON.stringify({ success: true, data: {
  capsules: rooms, page: { version: 1, observationId: "observation-1",
    observedAt: "2026-10-12T00:00:00.000Z", ownershipScope: "installation",
    populationCount: rooms.length, pageCount: rooms.length,
    nextCursor: null, disposition: "complete", ...extra },
} });
const room = (id, worktreePath = null) => ({ capsuleId: id, status: "working", worktreePath });

describe("complete ownership observation", () => {
  it("accepts an explicit empty population", () => {
    assert.equal(parseActiveWorktreePaths(pagePayload([])).available, true);
  });

  it("never accepts a partial page as the whole ownership inventory", () => {
    assert.equal(parseActiveWorktreePaths(pagePayload([room("one", "D:/wt/one")], {
      populationCount: 2, nextCursor: "next", disposition: "more",
    })).available, false);
  });

  it("protects an owner on a later page and keeps the same unfiltered traversal", async () => {
    const args = [];
    const result = await loadActiveWorkroomPaths({ env: { DPF_MCP_BEARER_TOKEN: "t" },
      fetchImpl: async (_url, init) => {
        args.push(JSON.parse(init.body).params.arguments);
        return new Response(args.length === 1
          ? pagePayload([room("one")], { populationCount: 2, nextCursor: "next", disposition: "more" })
          : pagePayload([room("two", "D:/wt/later")], { populationCount: 2 }));
      },
    });
    assert.equal(result.available, true);
    assert.ok(result.activePaths.has("d:/wt/later"));
    assert.deepEqual(args, [{ limit: 100 }, { limit: 100, cursor: "next" }]);
  });

  it("drops every partial claim if continuation fails", async () => {
    let calls = 0;
    const result = await loadActiveWorkroomPaths({ env: { DPF_MCP_BEARER_TOKEN: "t" },
      fetchImpl: async () => ++calls === 1
        ? new Response(pagePayload([room("one", "D:/wt/one")], { populationCount: 2, nextCursor: "next", disposition: "more" }))
        : new Response(JSON.stringify({ success: false, error: "cursor_authority_mismatch" })),
    });
    assert.equal(result.available, false);
    assert.equal(result.activePaths.size, 0);
  });

  // BI-83345811: an observation lives five minutes. A slow traversal (or many
  // detail reads) outlives it, and the server answers the next cursor with
  // snapshot_expired / restart-required. That is not an outage: start a fresh
  // observation, and never carry a claim from the expired one into it.
  it("restarts the whole traversal when the cursor expires, keeping nothing from the old observation", async () => {
    const args = [];
    const result = await loadActiveWorkroomPaths({ env: { DPF_MCP_BEARER_TOKEN: "t" },
      fetchImpl: async (_url, init) => {
        args.push(JSON.parse(init.body).params.arguments);
        if (args.length === 1) {
          return new Response(pagePayload([room("one", "D:/wt/stale")], { populationCount: 2, nextCursor: "next", disposition: "more" }));
        }
        if (args.length === 2) {
          // The route serializes a success:false tool result as isError content.
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { isError: true, content: [{ type: "text",
            text: JSON.stringify({ success: false, error: "snapshot_expired",
              data: { page: { version: 1, disposition: "restart-required" } } }) }] } }));
        }
        return new Response(pagePayload([room("two", "D:/wt/fresh")], { observationId: "observation-2" }));
      },
    });
    assert.equal(result.available, true);
    assert.ok(result.activePaths.has("d:/wt/fresh"));
    assert.ok(!result.activePaths.has("d:/wt/stale"));
    assert.deepEqual(args, [{ limit: 100 }, { limit: 100, cursor: "next" }, { limit: 100 }]);
  });

  it("fails closed when every restarted observation expires again", async () => {
    let calls = 0;
    const result = await loadActiveWorkroomPaths({ env: { DPF_MCP_BEARER_TOKEN: "t" },
      fetchImpl: async (_url, init) => {
        calls++;
        return new Response(JSON.parse(init.body).params.arguments.cursor
          ? JSON.stringify({ success: false, error: "snapshot_expired" })
          : pagePayload([room("one", "D:/wt/one")], { populationCount: 2, nextCursor: "next", disposition: "more" }));
      },
    });
    assert.equal(result.available, false);
    assert.equal(result.activePaths.size, 0);
    assert.match(result.reason, /expired/);
    assert.ok(calls <= 8, `restarts must be bounded, saw ${calls} calls`);
  });

// BI-83345811: the observation page is a compact summary. A row may carry no
// worktreePath (an older server, or a row shortened to fit the page budget);
// its governed detail reference is how the owner is resolved. A missing path is
// never read as "no owner".
describe("ownership resolved through the detail read", () => {
  const detailRef = id => ({ toolName: "get_workroom", arguments: { capsuleId: id } });
  const compactRoom = (id, extra = {}) => ({ capsuleId: id, status: "working", detail: detailRef(id), ...extra });
  const detailPayload = capsule => JSON.stringify({ success: true, data: { capsule } });

  const load = (pages, details) => {
    const calls = [];
    return loadActiveWorkroomPaths({ env: { DPF_MCP_BEARER_TOKEN: "t" },
      fetchImpl: async (_url, init) => {
        const { name, arguments: args } = JSON.parse(init.body).params;
        calls.push({ name, args });
        if (name === "get_workroom") {
          const reply = details[args.capsuleId];
          return typeof reply === "function" ? reply() : new Response(reply ?? JSON.stringify({ success: false, error: "not_found" }));
        }
        return new Response(pages[calls.filter(c => c.name === "list_workrooms").length - 1]);
      },
    }).then(result => ({ result, calls }));
  };

  it("protects a worktree whose path only the detail read carries", async () => {
    const { result, calls } = await load(
      [pagePayload([compactRoom("WC-1")])],
      { "WC-1": detailPayload({ capsuleId: "WC-1", status: "working", worktreePath: "D:/wt/from-detail" }) },
    );
    assert.equal(result.available, true, result.reason);
    assert.ok(pathHasActiveClaim(result.activePaths, "D:/wt/from-detail"));
    assert.deepEqual(calls.find(c => c.name === "get_workroom").args, { capsuleId: "WC-1" });
  });

  it("resolves a row whose worktreePath was shortened to fit the page", async () => {
    const { result } = await load(
      [pagePayload([compactRoom("WC-2", { worktreePath: "D:/wt/sho", shortenedFields: ["worktreePath"] })])],
      { "WC-2": detailPayload({ capsuleId: "WC-2", status: "working", worktreePath: "D:/wt/shortened-in-full" }) },
    );
    assert.equal(result.available, true, result.reason);
    assert.ok(result.activePaths.has("d:/wt/shortened-in-full"));
    assert.ok(!result.activePaths.has("d:/wt/sho"));
  });

  it("protects an owner that appears only on a later page through its detail", async () => {
    const { result } = await load([
      pagePayload([room("WC-A")], { populationCount: 2, nextCursor: "next", disposition: "more" }),
      pagePayload([compactRoom("WC-B")], { populationCount: 2 }),
    ], { "WC-B": detailPayload({ capsuleId: "WC-B", status: "blocked", worktreePath: "D:/wt/later-detail" }) });
    assert.equal(result.available, true, result.reason);
    assert.ok(result.activePaths.has("d:/wt/later-detail"));
  });

  it("fails closed when a row has no path and no detail reference", async () => {
    const { result } = await load([pagePayload([{ capsuleId: "WC-3", status: "working" }])], {});
    assert.equal(result.available, false);
    assert.equal(result.activePaths.size, 0);
  });

  it("fails closed when the detail read is missing, denied, malformed or for another room", async () => {
    for (const reply of [
      undefined,
      () => new Response("forbidden", { status: 403 }),
      () => { throw new Error("connection reset"); },
      JSON.stringify({ success: true, data: {} }),
      detailPayload({ capsuleId: "WC-other", status: "working", worktreePath: "D:/wt/x" }),
      detailPayload({ capsuleId: "WC-4", status: "working" }),
      detailPayload({ capsuleId: "WC-4", status: "mystery", worktreePath: "D:/wt/x" }),
    ]) {
      const { result } = await load(
        [pagePayload([room("WC-0", "D:/wt/sibling"), compactRoom("WC-4")])],
        { "WC-4": reply },
      );
      assert.equal(result.available, false, `reply ${String(reply)} must not read as available`);
      assert.equal(result.activePaths.size, 0);
    }
  });

  it("does not take a detail reference that points at a different room", async () => {
    const { result } = await load(
      [pagePayload([compactRoom("WC-5", { detail: detailRef("WC-6") })])],
      { "WC-6": detailPayload({ capsuleId: "WC-6", status: "working", worktreePath: "D:/wt/six" }) },
    );
    assert.equal(result.available, false);
  });

  it("keeps the observed claim when the detail now reads terminal, and a null path claims nothing", async () => {
    const { result } = await load(
      [pagePayload([compactRoom("WC-7"), compactRoom("WC-8")])],
      {
        "WC-7": detailPayload({ capsuleId: "WC-7", status: "abandoned", worktreePath: "D:/wt/seven" }),
        "WC-8": detailPayload({ capsuleId: "WC-8", status: "working", worktreePath: null }),
      },
    );
    assert.equal(result.available, true, result.reason);
    // The row said "working" when observed; a protective reader keeps that claim
    // even though the detail now reads terminal.
    assert.ok(result.activePaths.has("d:/wt/seven"));
    assert.equal(result.activePaths.size, 1);
  });
});

  it("uses the shared credential resolver, including refreshing client credentials", async () => {
    let resolved, tokenReads = 0, authorization;
    const result = await loadActiveWorkroomPaths({ env: {},
      resolveCredential: options => {
        resolved = options;
        return { bearer: { get: async () => { tokenReads++; return "client-credential-token"; } } };
      },
      fetchImpl: async (_url, init) => {
        authorization = init.headers.Authorization;
        return new Response(pagePayload([]));
      },
    });
    assert.equal(result.available, true);
    assert.equal(resolved.mcpUrl, "http://127.0.0.1:3000/api/mcp/v1");
    assert.equal(tokenReads, 1);
    assert.equal(authorization, "Bearer client-credential-token");
  });

  it("refuses malformed identities, shortened paths, scoped populations and truncated wrappers", () => {
    const valid = JSON.parse(pagePayload([room("one", "D:/wt/one")]));
    for (const bad of [
      { ...valid, success: false },
      { ...valid, data: { ...valid.data, _truncated: true } },
      JSON.parse(pagePayload([{ capsuleId: "one", status: "working" }])),
      JSON.parse(pagePayload([{ ...room("one", "D:/wt/one"), shortenedFields: ["worktreePath"] }])),
      JSON.parse(pagePayload([room("one")], { ownershipScope: "caller-visible" })),
      JSON.parse(pagePayload([room("one")], { populationCount: 3 })),
    ]) assert.equal(parseActiveWorktreePaths(JSON.stringify(bad)).available, false);
  });

  it("refuses changed snapshots, repeated rooms, count drift and cursor loops", async () => {
    for (const second of [
      pagePayload([room("two")], { populationCount: 2, observationId: "other" }),
      pagePayload([room("one")], { populationCount: 2 }),
      pagePayload([room("two")], { populationCount: 3 }),
      pagePayload([room("two")], { populationCount: 3, nextCursor: "next", disposition: "more" }),
    ]) {
      let calls = 0;
      const result = await loadActiveWorkroomPaths({ env: { DPF_MCP_BEARER_TOKEN: "t" },
        fetchImpl: async () => new Response(++calls === 1
          ? pagePayload([room("one")], { populationCount: 2, nextCursor: "next", disposition: "more" }) : second),
      });
      assert.equal(result.available, false);
      assert.equal(result.activePaths.size, 0);
      assert.ok(calls <= 2);
    }
  });
});

describe("parseActiveWorktreePaths", () => {
  it("collects worktrees of rooms that still own their work", () => {
    const { available, activePaths } = parseActiveWorktreePaths(
      roomsPayload([
        { capsuleId: "WC-1", status: "working", worktreePath: "D:/wt/alpha" },
        { capsuleId: "WC-2", status: "ready", worktreePath: "D:/wt/beta" },
      ]),
    );
    assert.equal(available, true);
    assert.equal(activePaths.size, 2);
    assert.ok(activePaths.has(normalizePath("D:/wt/alpha")));
  });

  it("ignores rooms in a terminal state", () => {
    const { activePaths } = parseActiveWorktreePaths(
      roomsPayload([
        { capsuleId: "WC-3", status: "abandoned", worktreePath: "D:/wt/gone" },
        { capsuleId: "WC-4", status: "complete", worktreePath: "D:/wt/done" },
        { capsuleId: "WC-5", status: "archived", worktreePath: "D:/wt/old" },
      ]),
    );
    assert.equal(activePaths.size, 0);
  });

  it("treats blocked and ready-for-review as still owned", () => {
    // A blocked room is waiting on something, not finished — reaping its tree
    // strands the very work that is waiting.
    for (const status of ["blocked", "ready-for-review", "ready-for-promotion", "verifying"]) {
      assert.ok(ACTIVE_WORKROOM_STATUSES.includes(status), `${status} must count as active`);
    }
  });

  it("reads an SSE-wrapped response", () => {
    const sse = `event: message\ndata: ${roomsPayload([
      { capsuleId: "WC-6", status: "working", worktreePath: "D:/wt/sse" },
    ])}\n\n`;
    const { available, activePaths } = parseActiveWorktreePaths(sse);
    assert.equal(available, true);
    assert.ok(activePaths.has(normalizePath("D:/wt/sse")));
  });

  it("matches regardless of separator or case", () => {
    const { activePaths } = parseActiveWorktreePaths(
      roomsPayload([{ capsuleId: "WC-7", status: "working", worktreePath: "D:\\WT\\Mixed\\" }]),
    );
    assert.ok(pathHasActiveClaim(activePaths, "D:/wt/mixed"));
  });

  it("reports UNAVAILABLE on an empty or unparseable response", () => {
    for (const bad of ["", "   ", "not json", undefined]) {
      const { available } = parseActiveWorktreePaths(bad);
      assert.equal(available, false, `${JSON.stringify(bad)} must not read as available`);
    }
  });

  it("reports UNAVAILABLE when the response carries no workroom list", () => {
    const { available } = parseActiveWorktreePaths(
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [] } }),
    );
    assert.equal(available, false);
  });
});

describe("loadActiveWorkroomPaths — fail safe, never fail open", () => {
  it("is UNAVAILABLE without a token, rather than an empty success", async () => {
    // The lease loader returns "" here, which reads downstream as "nothing is
    // leased" and protects nothing. This must not repeat that.
    const result = await loadActiveWorkroomPaths({ env: {},
      resolveCredential: () => { throw new Error("No MCP token or client credential configured"); },
      fetchImpl: () => { throw new Error("unused"); },
    });
    assert.equal(result.available, false);
    assert.match(result.reason, /token/i);
  });

  it("is UNAVAILABLE when the query returns an HTTP error", async () => {
    const result = await loadActiveWorkroomPaths({
      env: { DPF_MCP_BEARER_TOKEN: "t" },
      fetchImpl: async () => new Response("unauthorized", { status: 401 }),
    });
    assert.equal(result.available, false);
    assert.match(result.reason, /HTTP 401/);
  });

  it("is UNAVAILABLE when the transport fails", async () => {
    const result = await loadActiveWorkroomPaths({
      env: { DPF_MCP_BEARER_TOKEN: "t" },
      fetchImpl: async () => { throw new Error("connection refused"); },
    });
    assert.equal(result.available, false);
    assert.match(result.reason, /connection refused/);
  });

  it("asks the default loopback endpoint and sends the tool call", async () => {
    let seen = null;
    await loadActiveWorkroomPaths({
      env: { DPF_MCP_BEARER_TOKEN: "t" },
      fetchImpl: async (url, init) => {
        seen = { url, body: JSON.parse(init.body) };
        return new Response("", { status: 500 });
      },
    });
    assert.equal(seen.url, "http://127.0.0.1:3000/api/mcp/v1");
    assert.equal(seen.body.method, "tools/call");
    assert.equal(seen.body.params.name, "list_workrooms");
  });

  it("is AVAILABLE and returns claims on success", async () => {
    const result = await loadActiveWorkroomPaths({
      env: { DPF_MCP_BEARER_TOKEN: "t" },
      fetchImpl: async () =>
        new Response(roomsPayload([{ capsuleId: "WC-8", status: "working", worktreePath: "D:/wt/live" }]), {
          status: 200,
        }),
    });
    assert.equal(result.available, true);
    assert.ok(pathHasActiveClaim(result.activePaths, "D:/wt/live"));
  });
});

describe("pathHasActiveClaim", () => {
  it("is false for an empty or absent claim set rather than throwing", () => {
    assert.equal(pathHasActiveClaim(new Set(), "D:/wt/a"), false);
    assert.equal(pathHasActiveClaim(undefined, "D:/wt/a"), false);
  });
});

// A non-terminal STATUS is not proof anyone is coming back. The server's own
// liveness verdict (apps/web/lib/work-capsules/liveness.ts) already says when a
// room is dead; on 2026-10-27 391 non-terminal rooms on the dev install were
// lease-expired and still kept their trees (BI-CAA84E43).
describe("claims honour the server's liveness verdict", () => {
  const withVerdict = (id, path, verdict) => ({ ...room(id, path), ...verdict });

  it("releases the claim of a room the server calls reapable", () => {
    const result = parseActiveWorktreePaths(pagePayload([
      withVerdict("dead", "D:/wt/dead", { status: "ready", liveness: "lease-expired", isReapable: true }),
      withVerdict("live", "D:/wt/live", { liveness: "live", isReapable: false }),
    ]));
    assert.equal(result.available, true);
    assert.equal(pathHasActiveClaim(result.activePaths, "D:/wt/dead"), false);
    assert.equal(pathHasActiveClaim(result.activePaths, "D:/wt/live"), true);
    assert.match(result.reason, /1 non-live claim\(s\) released/);
  });

  it("keeps the claim when the verdict is missing, shortened or not a plain boolean", () => {
    const result = parseActiveWorktreePaths(pagePayload([
      withVerdict("missing", "D:/wt/missing", {}),
      withVerdict("shortened", "D:/wt/shortened", { isReapable: true, shortenedFields: ["isReapable"] }),
      withVerdict("string", "D:/wt/string", { isReapable: "true" }),
      withVerdict("paused", "D:/wt/paused", { liveness: "paused", isReapable: false }),
      withVerdict("nosignal", "D:/wt/nosignal", { liveness: "no-signal", isReapable: false }),
    ]));
    for (const id of ["missing", "shortened", "string", "paused", "nosignal"]) {
      assert.equal(pathHasActiveClaim(result.activePaths, `D:/wt/${id}`), true, id);
    }
  });

  it("releases a reapable room whose path only its detail read carries, without reading the detail", async () => {
    const names = [];
    const result = await loadActiveWorkroomPaths({ env: { DPF_MCP_BEARER_TOKEN: "t" },
      fetchImpl: async (_url, init) => {
        names.push(JSON.parse(init.body).params.name);
        return new Response(pagePayload([{ capsuleId: "WC-9", status: "ready", isReapable: true,
          detail: { toolName: "get_workroom", arguments: { capsuleId: "WC-9" } } }]));
      },
    });
    assert.equal(result.available, true);
    assert.equal(result.activePaths.size, 0);
    assert.deepEqual(names, ["list_workrooms"]);
  });
});


describe("ownership traversal uses one saved connection configuration (BI-02C0877D)", () => {
  it("prepares trust once for every page and detail without mutating the caller environment", async () => {
    const env = { DPF_MCP_URL: "https://localhost/api/mcp/v1", DPF_MCP_BEARER_TOKEN: "fixture" };
    const prepared = { ...env, NODE_EXTRA_CA_CERTS: "saved-authorized-ca.pem" };
    let resolutions = 0, credentialEnv;
    const calls = [];
    const result = await loadActiveWorkroomPaths({ env,
      resolveTrust: options => { resolutions++; assert.equal(options.env, env); return { env: prepared }; },
      resolveCredential: options => { credentialEnv = options.env; return { bearer: "fixture" }; },
      fetchImpl: async (_url, init) => {
        const { name, arguments: args } = JSON.parse(init.body).params;
        calls.push(name);
        if (name === "get_workroom") return new Response(JSON.stringify({ success: true, data: { capsule: room("two", "D:/wt/two") } }));
        return new Response(args.cursor
          ? pagePayload([{ capsuleId: "two", status: "working", detail: { toolName: "get_workroom", arguments: { capsuleId: "two" } } }], { populationCount: 2 })
          : pagePayload([room("one", "D:/wt/one")], { populationCount: 2, nextCursor: "next", disposition: "more" }));
      },
    });
    assert.equal(result.available, true);
    assert.equal(resolutions, 1);
    assert.equal(credentialEnv, prepared);
    assert.equal(env.NODE_EXTRA_CA_CERTS, undefined);
    assert.deepEqual(calls, ["list_workrooms", "list_workrooms", "get_workroom"]);
    assert.equal(result.activePaths.size, 2);
  });

  it("fails closed before credentials or requests when saved trust cannot be read", async () => {
    let requests = 0, credentials = 0;
    const result = await loadActiveWorkroomPaths({ env: { DPF_MCP_URL: "https://localhost/api/mcp/v1" },
      resolveTrust: () => { throw new Error("saved CA unreadable"); },
      resolveCredential: () => { credentials++; return { bearer: "fixture" }; },
      fetchImpl: async () => { requests++; return new Response(pagePayload([])); },
    });
    assert.equal(result.available, false);
    assert.match(result.reason, /saved CA unreadable/);
    assert.equal(requests, 0);
    assert.equal(credentials, 0);
  });
});
