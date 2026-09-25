// apps/web/lib/build/sandbox/ensure-merge-base.ts
//
// The sandbox repository is fetched shallow: on 2026-09-25 origin/main had a
// history of one commit, so every guard that scopes by `origin/main...HEAD`
// found no merge base, the preflight ran every guard unscoped, and the diff
// guards failed on changes the build never made (FB-D671B016: 15 guards).
// Deepen origin/main, bounded, until the build's merge base is reachable.

export type MergeBaseResult = { found: boolean; deepened: number };

const PROBE_OK = "__MB_OK__";
const PROBE_NONE = "__MB_NONE__";

export async function ensureMergeBaseWithMain(input: {
  exec: (containerId: string, command: string) => Promise<string>;
  containerId: string;
  workdir: string;
  /** Deepen rounds; each fetches 200 more commits of origin/main. */
  maxRounds?: number;
}): Promise<MergeBaseResult> {
  const maxRounds = input.maxRounds ?? 8;
  const cd = `cd '${input.workdir}'`;
  const probe = () =>
    input.exec(input.containerId, `${cd} && (git merge-base origin/main HEAD 2>/dev/null && echo ${PROBE_OK}) || echo ${PROBE_NONE}`);
  let deepened = 0;
  for (;;) {
    if ((await probe()).includes(PROBE_OK)) return { found: true, deepened };
    if (deepened >= maxRounds) return { found: false, deepened };
    // Unshallow first: the guard scripts re-fetch origin/main at depth 1 in a
    // shallow repo (fetchOriginMainSharedSafe), undoing any deepen. A complete
    // repo stays complete. Deepen only if unshallowing is not possible.
    const fetch = deepened === 0
      ? `${cd} && ((git rev-parse --is-shallow-repository | grep -q true && git fetch -q --unshallow origin main) || git fetch -q --deepen=200 origin main) 2>&1 || true`
      : `${cd} && git fetch -q --deepen=200 origin main 2>&1 || true`;
    await input.exec(input.containerId, fetch);
    deepened++;
  }
}
