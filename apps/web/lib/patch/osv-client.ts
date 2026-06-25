// Live OSV.dev client for one package@version. Uses the single /v1/query endpoint,
// which returns full vulnerability objects (severity, affected ranges, aliases) in one
// call — no separate detail fetch. Air-gapped installs can point OSV_BASE_URL at a mirror.

import type { OsvVuln } from "@dpf/db/patch";

const OSV_BASE = process.env.OSV_BASE_URL ?? "https://api.osv.dev";
const TIMEOUT_MS = Number(process.env.OSV_TIMEOUT_MS ?? 20000);

/** Query OSV for vulnerabilities affecting `name@version` in `ecosystem`. */
export async function fetchOsvVulns(ecosystem: string, name: string, version: string): Promise<OsvVuln[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${OSV_BASE}/v1/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: { ecosystem, name }, version }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`OSV HTTP ${res.status}`);
    const json = (await res.json()) as { vulns?: OsvVuln[] };
    return json.vulns ?? [];
  } finally {
    clearTimeout(timer);
  }
}
