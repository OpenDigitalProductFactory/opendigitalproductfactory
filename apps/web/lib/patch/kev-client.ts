// Live CISA Known Exploited Vulnerabilities (KEV) catalog client. Returns the set of
// exploited CVE ids used to escalate/route patch findings. CISA_KEV_URL can point at a
// mirror for air-gapped installs.

import { parseKevCatalog } from "@dpf/db/patch";

const KEV_URL =
  process.env.CISA_KEV_URL ??
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
const TIMEOUT_MS = Number(process.env.CISA_KEV_TIMEOUT_MS ?? 20000);

/** Fetch the CISA KEV catalog and return its CVE id set (empty on any failure path). */
export async function fetchKevCves(): Promise<Set<string>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(KEV_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`CISA KEV HTTP ${res.status}`);
    return parseKevCatalog(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
