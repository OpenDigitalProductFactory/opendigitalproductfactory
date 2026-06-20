#!/usr/bin/env node
/**
 * BI-1AFF530D — Static guard: no raw `new EventSource(...)` in portal code.
 *
 * Background (BI-864E83B0): the portal is served over HTTP/1.1, so a browser
 * caps connections at ~6 per origin and each open EventSource holds one slot
 * for its whole life. When a self-upgrade RECREATES the portal container, the
 * old Node process dies but a silent SSE socket has no traffic to fail on — so
 * a plain `new EventSource(url)` never fires `onerror`, never reconnects, and
 * becomes a ZOMBIE that keeps holding its slot. Enough zombies across tabs and
 * rebuilds exhaust the 6-slot cap and a fresh navigation to the portal hangs:
 * the recurring "Chrome wedged, had to restart the browser" defect. Only a
 * browser restart tears the zombie sockets down.
 *
 * The fix is to always go through the resilient wrapper, which runs a heartbeat
 * watchdog (the server emits a named `dpf-hb` event every ~15s) and force-
 * reconnects the moment a stream goes silent past the window — reaping the
 * zombie itself and freeing the slot:
 *
 *     import { useResilientEventSource } from "@/lib/hooks/useResilientEventSource";
 *
 *     useResilientEventSource(active ? url : null, { onMessage: (e) => { … } });
 *
 * A plain `new EventSource(...)` reintroduces the entire defect class, silently,
 * one component at a time — exactly how it came back after the first fix only
 * migrated two of the six consumers. This guard fails the build the moment a
 * seventh appears.
 *
 * Run: node scripts/check-no-raw-event-source.mjs
 * Exit 0 = clean; exit 1 = violations (with a clear, actionable report).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = [
  join(ROOT, "apps", "web", "app"),
  join(ROOT, "apps", "web", "components"),
  join(ROOT, "apps", "web", "lib"),
  join(ROOT, "apps", "web", "hooks"),
];

// `new EventSource(` with any whitespace. A bare construction is the only way
// to open a browser SSE stream, so this is precise — no false positives on
// method calls or our own helpers.
const RAW_EVENT_SOURCE = /new\s+EventSource\s*\(/;

// Files allowed to construct EventSource directly: the resilient wrapper that
// REPLACES every other consumer (it is the single sanctioned construction
// site), and this guard itself which documents the banned pattern. Keep tiny.
const ALLOW = new Set([
  "apps/web/lib/hooks/useResilientEventSource.ts",
  "scripts/check-no-raw-event-source.mjs",
]);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (["node_modules", ".next", "__snapshots__", "dist", "public", "coverage"].includes(entry)) continue;
      yield* walk(full);
    } else if (s.isFile()) {
      // Tests legitimately reference EventSource (mocks, fixtures).
      if (/\.(test|spec)\.[cm]?tsx?$/.test(full) || full.endsWith(".d.ts")) continue;
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      yield full;
    }
  }
}

const violations = [];

for (const baseDir of SCAN_DIRS) {
  for (const file of walk(baseDir)) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    if (ALLOW.has(rel)) continue;
    let body;
    try {
      body = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = body.split(/\r?\n/);
    lines.forEach((line, i) => {
      // Skip obvious comment-only lines so a doc reference to the pattern
      // doesn't trip the guard. Real constructions are statements.
      const trimmed = line.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return;
      if (RAW_EVENT_SOURCE.test(line)) {
        violations.push(`${rel}:${i + 1}  ${trimmed.slice(0, 100)}`);
      }
    });
  }
}

if (violations.length > 0) {
  console.error("");
  console.error("ERROR: BI-1AFF530D — raw `new EventSource(...)` found in portal code.");
  console.error("");
  console.error("A plain EventSource has no liveness watchdog: when a self-upgrade recreates");
  console.error("the portal container, the silent socket never errors, never reconnects, and");
  console.error("becomes a ZOMBIE holding one of the browser's ~6 HTTP/1.1 slots per origin.");
  console.error("Enough zombies wedge the whole portal until the browser is restarted");
  console.error("(BI-864E83B0). Use the resilient wrapper, which heartbeats + self-heals:");
  console.error("");
  console.error('    import { useResilientEventSource } from "@/lib/hooks/useResilientEventSource";');
  console.error("");
  console.error("    useResilientEventSource(active ? url : null, {");
  console.error("      onMessage: (e) => { /* parse e.data */ },");
  console.error("    });");
  console.error("");
  for (const v of violations) console.error("  " + v);
  console.error("");
  console.error("Pass `null` as the URL when the stream should be inactive; the hook owns");
  console.error("connect, heartbeat-watchdog, reconnect, and teardown.");
  console.error("");
  process.exit(1);
}

console.log("✓ No raw EventSource: all SSE consumers go through useResilientEventSource (heartbeat watchdog).");
