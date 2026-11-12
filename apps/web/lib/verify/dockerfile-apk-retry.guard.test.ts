// Guard: every `apk add` in a shipped Dockerfile retries a failed fetch.
//
// WHY (BI-7FFF5CB0): SUR-B0A4610D and SUR-FF879116 failed the whole self-upgrade
// at the candidate promoter's `apk add` (exit 9 / 14 = packages apk could not
// fetch) because the host's outbound network dropped connections for a few
// seconds. The identical command succeeded seconds later. A single un-retried
// network fetch inside a build the upgrade depends on turns any network blip
// into a failed upgrade, so the retry is required everywhere apk runs.
//
// The required shape (busybox sh):
//   RUN for attempt in 1 2 3 4 5; do \
//         apk --timeout 60 add --no-cache ... && break; \
//         if [ "$attempt" = 5 ]; then echo "apk add failed after 5 attempts" >&2; exit 1; fi; \
//         ...; sleep $((attempt * 5)); \
//       done

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

/** Join backslash-continued lines into whole Dockerfile instructions. */
export function dockerInstructions(dockerfile: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const raw of dockerfile.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!current && /^\s*#/.test(line)) continue;
    if (current && /^\s*#/.test(line)) continue; // comments inside continuations
    current += (current ? " " : "") + line.replace(/\\$/, "").trim();
    if (!line.endsWith("\\")) {
      if (current.trim()) out.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export function apkAddWithoutRetry(dockerfile: string): string[] {
  return dockerInstructions(dockerfile)
    .filter((i) => /^RUN\b/i.test(i) && /\bapk\b(?: --timeout \d+)? add\b/.test(i))
    .filter((i) => !(/for attempt in 1 2 3 4 5; do/.test(i)
      // A stalled fetch must fail (and be retried) rather than hang the build.
      && /apk --timeout \d+ add[^;]*&& break;/.test(i)
      && /exit 1; fi;/.test(i)));
}

function shippedDockerfiles(): string[] {
  return execFileSync("git", ["ls-files", "--", "Dockerfile*", "**/Dockerfile*"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((p) => /(^|\/)Dockerfile[^/]*$/.test(p));
}

describe("apk retry guard", () => {
  it("flags a bare apk add and accepts the retry loop", () => {
    expect(apkAddWithoutRetry("FROM x\nRUN apk add --no-cache git \\\n  && echo hi\n")).toHaveLength(1);
    // A loop without a network timeout can still hang the whole build.
    expect(apkAddWithoutRetry("RUN for attempt in 1 2 3 4 5; do apk add git && break; if [ \"$attempt\" = 5 ]; then exit 1; fi; done")).toHaveLength(1);
    const wrapped = [
      "RUN for attempt in 1 2 3 4 5; do \\",
      "      apk --timeout 60 add --no-cache git && break; \\",
      "      if [ \"$attempt\" = 5 ]; then echo failed >&2; exit 1; fi; \\",
      "      sleep $((attempt * 5)); \\",
      "    done",
    ].join("\n");
    expect(apkAddWithoutRetry(wrapped)).toEqual([]);
  });

  it("every shipped Dockerfile retries its apk fetches", () => {
    const files = shippedDockerfiles();
    expect(files).toContain("Dockerfile.promoter");
    const offenders = files.flatMap((f) =>
      apkAddWithoutRetry(readFileSync(join(REPO_ROOT, f), "utf8")).map((i) => `${f}: ${i.slice(0, 120)}`));
    expect(offenders).toEqual([]);
  });
});
