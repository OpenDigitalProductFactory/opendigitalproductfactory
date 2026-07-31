#!/usr/bin/env node
// scripts/harness/archetype-exercise.mjs (draft — BI-41D8DF5F)
//
// Redeployable archetype exercise harness. Stands up a full archetype scenario
// on a running portal and exercises it through the REAL public + admin HTTP
// surfaces — the same requests the UI makes — so what it proves is what a
// non-technical staff crew would experience.
//
//   node scripts/harness/archetype-exercise.mjs --scenario restaurant \
//     [--portal http://localhost:3000] [--reset] [--report out.json]
//
// Credentials: ADMIN_EMAIL (default admin@dpf.local) + ADMIN_PASSWORD env.
// Scenario packs live in scripts/harness/scenarios/<name>.mjs and export:
//   { archetypeId, identity, catalog: [items], personas: [guests],
//     demand: [{kind: "order"|"booking", item, persona, qty|slot}, ...],
//     stubs: {…} }

import { parseArgs } from "node:util";

const args = parseArgs({
  options: {
    scenario: { type: "string" },
    portal: { type: "string", default: "http://localhost:3000" },
    reset: { type: "boolean", default: false },
    report: { type: "string" },
  },
}).values;

if (!args.scenario) {
  console.error("--scenario <name> is required (e.g. restaurant)");
  process.exit(2);
}

const PORTAL = args.portal.replace(/\/$/, "");
const EMAIL = process.env.ADMIN_EMAIL ?? "admin@dpf.local";
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!PASSWORD) {
  console.error("ADMIN_PASSWORD env var is required (see the install's .env)");
  process.exit(2);
}

// ── Cookie-jar fetch (NextAuth credentials sign-in) ─────────────────────────
const jar = new Map();
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
function storeCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
async function http(path, init = {}) {
  const res = await fetch(`${PORTAL}${path}`, {
    redirect: "manual",
    ...init,
    headers: { cookie: cookieHeader(), ...(init.headers ?? {}) },
  });
  storeCookies(res);
  return res;
}

async function login() {
  const csrfRes = await http("/api/auth/csrf");
  const { csrfToken } = await csrfRes.json();
  const body = new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD });
  // The employee/admin credentials provider id is "workforce" (customer portal
  // uses "customer") — see apps/web/lib/govern/auth.ts.
  const res = await http("/api/auth/callback/workforce", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (res.status >= 400) throw new Error(`login failed: ${res.status}`);
  const check = await http("/api/auth/session");
  const session = await check.json().catch(() => null);
  if (!session?.user) throw new Error("login did not establish a session");
  console.log(`[harness] signed in as ${EMAIL}`);
}

// ── Steps ───────────────────────────────────────────────────────────────────
const report = { scenario: args.scenario, startedAt: new Date().toISOString(), steps: [], observations: [] };
function step(name, detail) {
  report.steps.push({ name, detail, at: new Date().toISOString() });
  console.log(`[harness] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function resetArchetype(scenario) {
  const res = await http("/api/storefront/admin/archetype-reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetArchetypeId: scenario.archetypeId, identity: scenario.identity }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`archetype-reset failed: ${res.status} ${JSON.stringify(body)}`);
  step("archetype-reset", `${scenario.archetypeId}${body.result?.warnings?.length ? ` warnings=${body.result.warnings.length}` : ""}`);
}

async function seedCatalog(scenario) {
  const existing = await (await http("/api/storefront/admin/items")).json();
  const have = new Set(existing.map((i) => i.name));
  let created = 0;
  for (const item of scenario.catalog) {
    if (have.has(item.name)) continue;
    const res = await http("/api/storefront/admin/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    if (res.status !== 201) throw new Error(`item create failed (${item.name}): ${res.status}`);
    created++;
  }
  step("seed-catalog", `${created} created, ${scenario.catalog.length - created} already present`);
}

async function resolveSlugAndItems() {
  // The public storefront page needs the org slug; items need their ITEM-* ids.
  const items = await (await http("/api/storefront/admin/items")).json();
  return new Map(items.map((i) => [i.name, i]));
}

async function generateDemand(scenario, itemsByName, orgSlug) {
  let orders = 0;
  for (const d of scenario.demand) {
    if (d.kind !== "order") continue; // booking driver lands with the next slice
    const item = itemsByName.get(d.item);
    if (!item) throw new Error(`demand references unknown item ${d.item}`);
    const p = d.persona;
    const res = await http(`/api/storefront/${orgSlug}/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: item.itemId,
        quantity: d.qty ?? 1,
        customerName: p.name,
        email: p.email,
        address: p.address,
      }),
    });
    // Public order submission is a server action on the page in today's build;
    // when no JSON API exists, the harness records the gap instead of faking it.
    if (res.status === 404 || res.status === 405) {
      report.observations.push({
        kind: "capability-gap",
        detail: "No public JSON order-submission API; orders must go through the page server action.",
      });
      break;
    }
    if (!res.ok) throw new Error(`order failed (${d.item} for ${p.name}): ${res.status}`);
    orders++;
  }
  step("generate-demand", `${orders} orders submitted`);
}

async function seedStock(scenario, itemsByName) {
  const stock = scenario.stock ?? [];
  if (stock.length === 0) return;
  let created = 0;
  let gaps = 0;
  for (const entry of stock) {
    const usedBy = (entry.usedBy ?? [])
      .map((line) => {
        const item = itemsByName.get(line.item);
        if (!item) return null;
        return { storefrontItemId: item.itemId, quantityPerUnit: line.quantityPerUnit };
      })
      .filter(Boolean);
    const res = await http("/api/storefront/admin/stock-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...entry, usedBy }),
    });
    if (res.status === 404 || res.status === 405) {
      report.observations.push({
        kind: "capability-gap",
        detail: "No stock-items admin API on this install; stock coverage cannot be seeded.",
      });
      return;
    }
    if (!res.ok) throw new Error(`stock seed failed (${entry.name}): ${res.status}`);
    const body = await res.json().catch(() => ({}));
    if ((body.componentsLinked ?? 0) < usedBy.length) gaps++;
    created++;
  }
  step("seed-stock", `${created} supplies seeded${gaps ? `, ${gaps} with unresolved recipe lines` : ""}`);
}

// ── Main ────────────────────────────────────────────────────────────────────
const { default: scenario } = await import(`./scenarios/${args.scenario}.mjs`);
await login();
if (args.reset) await resetArchetype(scenario);
await seedCatalog(scenario);
const itemsByName = await resolveSlugAndItems();
await seedStock(scenario, itemsByName);
await generateDemand(scenario, itemsByName, scenario.orgSlug);
report.finishedAt = new Date().toISOString();
if (args.report) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(args.report, JSON.stringify(report, null, 2));
}
console.log(`[harness] done — ${report.steps.length} steps, ${report.observations.length} observations`);
