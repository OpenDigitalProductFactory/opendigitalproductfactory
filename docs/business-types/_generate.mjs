// ============================================================================
// Generator for the /business-types/ hub + per-business pages.
// Run from the repository root: pnpm docs:business-types
// Verify committed output without writing: pnpm docs:business-types:check
// Emits: index.html (hub) and one <slug>.html per business type.
// Files starting with "_" are ignored by Jekyll, so this script + the content
// module are never published — only the HTML they produce.
// ============================================================================

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import storefrontTemplates from "../../packages/storefront-templates/src/index.ts";
import { groups, pages, pagesByGroup } from "./_content.mjs";
import { analyze, band, TIERS } from "./_readability.mjs";

const { ALL_ARCHETYPES, deriveOperationalValueStream } = storefrontTemplates;

// Target reading level for BUSINESS-FACING copy — the "archetype" tier of the
// platform readability policy (high-school, plain English). Technical sections
// (standards, archetype-engine internals) are the "architecture" tier (uncapped).
const READING_TARGET = TIERS.archetype.maxGrade;

const __dirname = dirname(fileURLToPath(import.meta.url));
const processProjection = JSON.parse(
  readFileSync(join(__dirname, "_process-projection.generated.json"), "utf8"),
);
const leafProcesses = Object.values(processProjection.archetypes ?? {});

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const PUBLIC_LEAF_ALIASES = {
  "Pressure washing": "pressure-washing",
  "Windshield & auto glass": "auto-glass",
  "Mobile detailing": "mobile-detailing",
  "Mobile tyre service": "mobile-tire",
  "Courier & delivery": "courier-delivery",
  "Last-mile freight": "last-mile-freight",
  "Security guard & patrol": "guard-patrol",
  "Alarm & CCTV installation & monitoring": "alarm-cctv-install",
  "Mobile phlebotomy": "mobile-phlebotomy",
  "Medical equipment delivery": "dme-delivery",
  "Mobile grooming": "mobile-pet-grooming",
  "Member-owned cooperative": "cooperative",
  "Agricultural co-op (shared machinery)": "agricultural-cooperative",
  "Municipal utility": "municipal-utility",
  "Law-enforcement agency": "law-enforcement-agency",
  "Mortgage lending": "mortgage-lending",
  "Field inspection": "field-inspection",
  "Open Digital Product Factory (and software products like it)": "software-platform",
};

const normalizeLabel = (value) =>
  String(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Resolve the public-facing category labels to the canonical registry. The
 * alias table only bridges deliberately shorter public labels; every returned
 * object remains the canonical ArchetypeDefinition used by the portal.
 */
export function resolveCanonicalLeaves(page) {
  return page.leaf.map((label) => {
    const alias = PUBLIC_LEAF_ALIASES[label];
    const matches = ALL_ARCHETYPES.filter((archetype) =>
      alias
        ? archetype.archetypeId === alias
        : normalizeLabel(archetype.name) === normalizeLabel(label),
    );
    if (matches.length !== 1) {
      throw new Error(
        `Public leaf "${label}" on ${page.slug} resolved to ${matches.length} canonical archetypes.`,
      );
    }
    return matches[0];
  });
}

const pageForArchetype = new Map();
for (const page of pages) {
  for (const archetype of resolveCanonicalLeaves(page)) {
    // A public category can intentionally cross-list a leaf (for example a
    // dance studio under fitness and training). The leaf still has one URL and
    // one canonical definition; the first curated category is its breadcrumb.
    if (!pageForArchetype.has(archetype.archetypeId)) pageForArchetype.set(archetype.archetypeId, page);
  }
}

const humanize = (value) =>
  String(value)
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

// ---- value-stream strip (CSS, reflows vertical on mobile) ------------------
function vstreamStrip(stages, lanes = {}) {
  const topLane = lanes.top ?? "Governance, trust, and evidence — across every step";
  const bottomLane = lanes.bottom ?? "Capacity and demand signals — measured across the flow";
  const items = stages
    .map((s, i) => {
      const conn = i < stages.length - 1 ? `<li class="vconn" aria-hidden="true"></li>` : "";
      const key = s.key ? " key" : "";
      const keytag = s.key ? `<span class="keytag">make-or-break</span>` : "";
      return `<li class="vstage${key}"><span class="vstep">S${i + 1}</span><span class="vlabel">${esc(
        s.label
      )}</span>${keytag}</li>${conn}`;
    })
    .join("\n        ");
  return `<div class="vstream-card">
      <p class="vstream-lane">${esc(topLane)}</p>
      <ul class="vstream">
        ${items}
      </ul>
      <p class="vstream-lane bottom">${esc(bottomLane)}</p>
    </div>`;
}

// ---- mobile vision callout (honest: foundation real, app not yet shipped) --
function mobileLead(page) {
  return page.mobile
    ? `For ${page.display.toLowerCase()}, the phone is where the work happens. We want a field app that shows the next job, maps the way there, takes photos and a signature, and makes the invoice on the spot — even with no signal.`
    : `Even when the work isn’t in the field, you are. We want a pocket app that pings you when a coworker needs a yes or no on a risky step, and lets your customers book, track, and pay from your own branded app.`;
}

// ---- shared chrome ---------------------------------------------------------
function topbar() {
  return `<header class="topbar"><div class="wrap topbar-inner">
    <a class="topbar-brand" href="/"><img src="/assets/logos/OpenDigitalProductFactory.png" alt="" width="934" height="688"/>Open Digital Product Factory</a>
    <nav class="topbar-nav" aria-label="Primary">
      <a href="/business-types/">All business types</a>
      <a href="/business-types/partners.html">Partners &amp; builders</a>
      <a href="/business-types/architecture.html">Architecture</a>
      <a href="/#install">Install</a>
    </nav>
  </div></header>`;
}

function footer() {
  return `<footer class="site"><div class="wrap">
    <p>Open Digital Product Factory · <a href="/">Home</a> · <a href="/business-types/">All business types</a> · <a href="https://github.com/OpenDigitalProductFactory/opendigitalproductfactory">GitHub repository</a></p>
    <p class="muted" style="margin:6px 0 0; font-size:13px;">Running an organization? Start with its business type. <a href="/business-types/partners.html">Partners and builders</a> and <a href="/business-types/architecture.html">architecture reviewers</a> have separate paths.</p>
  </div></footer>`;
}

function secondaryAudienceLinks() {
  return `<aside class="secondary-paths" aria-label="Other audiences">
    <p><strong>Not running this organization?</strong></p>
    <a href="/business-types/partners.html">For resellers, builders, and delivery partners →</a>
    <a href="/business-types/architecture.html">For architects and standards reviewers →</a>
  </aside>`;
}

// ---- core-message callout --------------------------------------------------
function calloutHTML() {
  return `<div class="callout">
      <p class="ck">In plain terms</p>
      <p>One install gives you a <b>website your community can use</b>, a <b>place to run the work</b>, and <b>AI coworkers that already speak your line of work</b>. You approve the important moves, and everything stays on your own computers.</p>
    </div>`;
}

// ---- capability → product surface (inference, overridable per-cap) ----------
function surfaceFor(cap) {
  if (cap.surface) return cap.surface;
  const t = (cap.lead + " " + cap.rest).toLowerCase();
  // Order matters: more-specific surfaces win before the generic "estate" net,
  // so "billing … recorded" → Finance and "KYC … records" → Compliance.
  if (/dispatch|patrol|\bboard\b|routing|\broute\b|\bcrew\b|real-time|incident/.test(t)) return "Work board";
  if (/vocabulary|\bcoworker\b|language|framing/.test(t)) return "AI coworker";
  if (/invoic|billing|\bfee\b|deposit|\bpayment\b|payout|p&l|chargeable/.test(t)) return "Invoicing & finance";
  if (/complian|licens|\bkyc\b|aml|safeguard|\bcert\b|disclosure|consent/.test(t)) return "Licence & safety checks";
  if (/recurr|renewal|lifecycle|membership|subscription|recall|retention|patronage/.test(t)) return "Reminders & renewals";
  if (/storefront|intake|inquir|catalog|cart|checkout|portal|booking|\bbook\b|\bslot|calculator|donation/.test(t)) return "Website & enquiries";
  if (/record|history|estate|\baccount\b|patient|\bpet\b|\bunit\b|\basset|isolation|per-client|profile/.test(t)) return "Customer records";
  if (/vocabulary|coworker|language|framing|\bagent\b/.test(t)) return "AI coworker";
  return "AI coworker & workflow";
}

// ---- short operator summaries used by the readability projection ------------
const USE_LINE = {
  field: "Capture urgent jobs, dispatch the right technician, hold maintenance plans, and invoice from the field.",
  book: "Fill the calendar with the right people, keep the records on hand, and nudge the rebooking.",
  sell: "Turn a catalogue into orders without dropping a product image, a price, or a delivery detail.",
  members: "Take applications, donations, and requests through a trust gate — and account for every fee or receipt.",
  build: "Move from inquiry to proposal to milestone billing, with each client’s estate kept clean and isolated.",
};

// ---- standards / reference implementation (grounded, no overclaim) ---------
const STD = {
  now: [
    ["Route-scoped AI coworkers", "each route gets a purpose-built coworker with its own tools and vocabulary"],
    ["Tool authority = grant ∩ user capability", "every tool exposure filtered by user authority, mode, and external-access posture"],
    ["Proposal-mode gated actions", "consequential actions break the loop and return an approval payload instead of executing"],
    ["Tool-execution audit logging", "every call written to <code>ToolExecution</code> — agent, user, tool, params, result, route, duration, audit class"],
    ["Archetype-driven UX &amp; vocabulary", "storefront, scheduling, finance and compliance defaults generated from one archetype"],
    ["Internal agent registry", "stable identifiers, model bindings, supervisors, delegates, grants, HITL defaults"],
  ],
  partial: [
    ["TAK runtime transparency", "an Authority &amp; Audit workspace with a supervisor-ready Agent Card snapshot"],
    ["Agent Card / AIDoc projection", "the registry approximates an AIDoc — not yet signed or resolvable"],
    ["Stable internal agent identity", "platform-local today, not yet canonical GAID identifiers"],
    ["HITL tier metadata", "carried per agent, not yet one uniform runtime policy engine"],
    ["Delegation &amp; authority modeling", "supervisor &amp; delegation recorded, not yet a receipt-backed chain"],
    ["Chain-of-custody trace", "agent, user, route and tool recorded; not yet end-to-end across boundaries"],
  ],
  planned: [
    ["Signed / tamper-evident receipts", "cryptographically verifiable receipts for consequential actions"],
    ["GAID public/private namespaces", "explicit private vs externally-accredited public identity scopes"],
    ["Public verifier metadata", "published A2A Agent Cards and external receipt-status endpoints"],
    ["External certificates &amp; status", "issuer validation and public status services for exposed agents"],
    ["Capability &amp; governance badges", "evidence-backed assurance levels"],
    ["Repeatable conformance suites", "automated TAK &amp; GAID test packs preserved as evidence"],
  ],
};
function standardsSection() {
  const col = (cls, title, items) =>
    `<div class="std-col ${cls}"><h3><span class="dot"></span>${title}</h3><ul>${items
      .map(([a, b]) => `<li><b>${a}</b> — ${b}</li>`)
      .join("")}</ul></div>`;
  return `<section id="standards" aria-label="DPF as a reference implementation">
    <p class="section-eyebrow">For architects &amp; standards reviewers</p>
    <h2>DPF as a reference implementation</h2>
    <p class="sub">DPF is a working prototype for two proposed standards — <strong>not</strong> a claim of full present-day conformance. <strong>TAK</strong> governs <em>what an agent may do</em>; <strong>GAID</strong> governs <em>who the agent is and what evidence follows its actions</em>. Here is what is real today, what is partial, and what is still proposed — the gaps are mapped, not hidden.</p>
    <div class="std-frame">
      <div class="std-def"><h4><span class="k">TAK</span> — Trusted AI Kernel</h4><p>The runtime-governance harness: authority mediation, tool-execution gating, human-in-the-loop, memory limits, and audit/evidence — enforced as an agent operates.</p></div>
      <div class="std-def"><h4><span class="k">GAID</span> — Global AI Agent Identification &amp; Governance</h4><p>Who an agent is, the claims it carries, and how its actions are identified and traced — identity documents, badges, authorization classes, and action receipts.</p></div>
    </div>
    <div class="std-cols">
      ${col("now", "Implemented now", STD.now)}
      ${col("partial", "Partially implemented", STD.partial)}
      ${col("planned", "Planned / proposed", STD.planned)}
    </div>
    <p class="std-note muted" style="margin-top:14px;">Grounded in the platform’s own first-pass assessment: <a href="/architecture/agent-standards-dpf-conformance">TAK / GAID conformance assessment</a> · <a href="/architecture/trusted-ai-kernel">TAK</a> · <a href="/architecture/GAID">GAID</a> · <a href="/architecture/2026-04-18-trusted-ai-agent-governance-white-paper">governance white paper</a>. DPF is the proving ground where these ideas are exercised in real workflows.</p>
  </section>`;
}

// ---- readability: the business-facing copy a small-business owner reads -----
// Deliberately excludes the technical sections (standards, archetype-engine
// internals, Agent Card) — those are allowed to read higher.
function businessCopy(page) {
  const parts = [page.who, page.model];
  page.stages.forEach((s) => parts.push(s.label));
  page.problems.forEach((x) => parts.push(x.lead, x.rest));
  page.caps.forEach((x) => parts.push(x.lead, x.rest));
  parts.push(USE_LINE[page.group]);
  parts.push(mobileLead(page));
  return parts.join(". ");
}
function readabilityNote(page) {
  const a = analyze(businessCopy(page));
  const ok = a.gradeLevel <= READING_TARGET;
  return `<p class="reading-note"><span class="rn-dot ${ok ? "ok" : "warn"}"></span>Plain-language checked — the everyday copy on this page reads at about a <strong>Grade ${a.gradeLevel.toFixed(
    0
  )}</strong> level (Flesch–Kincaid Reading Ease ${a.readingEase.toFixed(0)}). We hold business copy to a high-school reading level; the architecture and standards sections are intentionally more technical.</p>`;
}

// ---- per-business page -----------------------------------------------------
function leafProcessPageHTML(model, parentSlug) {
  const stageByKey = new Map(
    model.streams.flatMap((stream) => stream.stages.map((stage) => [stage.key, stage])),
  );
  const streamSections = model.streams
    .map((stream, streamIndex) => {
      const stages = stream.stages
        .map((stage, stageIndex) => {
          const handoff = stage.handoffToStageKey
            ? stageByKey.get(stage.handoffToStageKey)?.label ?? humanize(stage.handoffToStageKey)
            : stageIndex < stream.stages.length - 1
              ? stream.stages[stageIndex + 1].label
              : streamIndex < model.streams.length - 1
                ? model.streams[streamIndex + 1].label
                : "Outcome review";
          const gates = stage.trustGateKeys.length
            ? stage.trustGateKeys.map(humanize).join(", ")
            : "Routine work within approved care policy";
          return `<tr>
            <td><strong>${esc(stage.label)}</strong></td>
            <td>${esc(stage.input)}</td>
            <td>${esc(stage.output)}</td>
            <td>${esc(stage.responsibleRole)}</td>
            <td>${esc(gates)}</td>
            <td>${esc(handoff)}</td>
          </tr>`;
        })
        .join("\n");

      return `<section aria-labelledby="stream-${esc(stream.key)}">
        <p class="section-eyebrow">Primary value stream ${streamIndex + 1}</p>
        <h2 id="stream-${esc(stream.key)}">${esc(stream.label)}</h2>
        <p class="sub">${esc(stream.purpose)}</p>
        <div class="twocol">
          <div class="card"><h3>Starts with</h3><p>${esc(stream.input)}</p></div>
          <div class="card"><h3>Finishes with</h3><p>${esc(stream.output)}</p></div>
        </div>
        <p class="sub"><strong>Accountable lead:</strong> ${esc(stream.responsibleRole)}</p>
        <div class="diagram-scroll" role="region" aria-label="${esc(stream.label)} stage details" tabindex="0">
          <table style="width:100%;border-collapse:collapse;min-width:980px">
            <thead><tr><th scope="col">Stage</th><th scope="col">Input</th><th scope="col">Output</th><th scope="col">Responsible</th><th scope="col">Approval or trust gate</th><th scope="col">Handoff</th></tr></thead>
            <tbody>${stages}</tbody>
          </table>
        </div>
      </section>`;
    })
    .join("\n");

  const support = model.supportingCapabilities
    .map((capability) => `<li class="chip">${esc(capability)}</li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(model.name)} operating model — Open Digital Product Factory</title>
<meta name="description" content="The intake, health and welfare, and adoption value streams that define how a pet rescue operates."/>
<link rel="stylesheet" href="/assets/css/business.css"/>
</head>
<body id="top" data-canonical-archetype-id="${esc(model.archetypeId)}">
${topbar()}
<section class="hero"><div class="wrap">
  <p class="eyebrow"><span class="dot"></span>Pet rescue · operating model</p>
  <h1>How ${esc(model.name)} protects an animal from intake to placement</h1>
  <p class="tagline">Three connected flows keep the animal—not fundraising or sales—at the centre of the work.</p>
  <p class="lede">Use this view to see what starts each stream, who is responsible, what evidence allows work to advance, and where the animal is handed to the next team.</p>
  <div class="cta-row"><a class="btn" href="/business-types/${esc(parentSlug)}.html">← Nonprofits &amp; community</a><a class="btn primary" href="/#install">Install the platform</a></div>
</div></section>
<main class="wrap">
  <section aria-label="Definition status">
    <div class="evidence-note">
      <span class="badge">Canonical projection · shipped definition</span>
      <h2>This process comes from the installed Pet Rescue definition</h2>
      <p>The public stages below are generated from the same archetype process model used by the platform. The generation check fails if this page or its process projection drifts from source.</p>
    </div>
  </section>
  <section aria-label="Operating model summary">
    <p class="section-eyebrow">The animal journey</p>
    <h2>One journey, three accountable value streams</h2>
    <p class="sub">An animal enters through intake, remains in health and welfare care until it is ready, then moves through adoption and placement. A failed placement returns safely to intake and care; it does not disappear from the record.</p>
  </section>
  ${streamSections}
  <section aria-labelledby="supporting-work">
    <p class="section-eyebrow">Enabling work</p>
    <h2 id="supporting-work">Supporting capabilities</h2>
    <p class="sub">These capabilities sustain the rescue, but they do not replace the animal's progression through intake, care, and placement.</p>
    <ul class="chips">${support}</ul>
  </section>
</main>
${footer()}
<a class="back-top" href="#top" aria-label="Back to top">↑ Top</a>
</body>
</html>`;
}

function pageHTML(page) {
  const g = groups.find((x) => x.id === page.group);
  const canonicalLeaves = resolveCanonicalLeaves(page);
  const chips = canonicalLeaves
    .map(
      (leaf) =>
        `<li class="chip"><a href="/business-types/archetypes/${esc(leaf.archetypeId)}.html">${esc(leaf.name)}</a></li>`,
    )
    .join("");
  const leafCards = canonicalLeaves
    .map((leaf) => {
      const model = deriveOperationalValueStream(leaf);
      const loadBearing = model.stages.filter((stage) => stage.loadBearing).map((stage) => stage.label);
      return `<a class="card linkcard archetype-card" href="/business-types/archetypes/${esc(leaf.archetypeId)}.html">
        <span class="status-kicker">Canonical profile</span>
        <h3>${esc(leaf.name)} <span class="arrow" aria-hidden="true">→</span></h3>
        <p>${esc(loadBearing.length ? `Current load-bearing stage: ${loadBearing.join(" and ")}.` : "Open the current operating definition.")}</p>
        <p class="leafline">${esc(model.capacityUnit.replaceAll("-", " "))} · ${esc(model.demandSignature.replaceAll("-", " "))}</p>
      </a>`;
    })
    .join("\n        ");
  const problems = page.problems
    .map(
      (p) =>
        `<li><span class="ic" aria-hidden="true">!</span><span class="tx"><span class="lead">${esc(
          p.lead
        )}</span> ${esc(p.rest)}</span></li>`
    )
    .join("\n          ");
  const caps = page.caps
    .map(
      (c) =>
        `<li><span class="ic" aria-hidden="true">✓</span><span class="tx"><span class="lead">${esc(
          c.lead
        )}</span> ${esc(c.rest)} <span class="surface-badge" title="DPF product surface">${esc(
          surfaceFor(c)
        )}</span></span></li>`
    )
    .join("\n          ");
  const compliance = page.compliance
    ? `<section aria-label="Trust and compliance"><div class="note"><strong>Trust &amp; compliance.</strong> ${esc(
        page.compliance
      )}</div></section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>DPF for ${esc(page.display)} — Open Digital Product Factory</title>
<meta name="description" content="How the Open Digital Product Factory helps ${esc(
    page.display.toLowerCase()
  )} businesses: the value we deliver, the problems we solve, the business model, and the capabilities — with the mobile vision."/>
<link rel="stylesheet" href="/assets/css/business.css"/>
</head>
<body id="top">
${topbar()}

<section class="hero"><div class="wrap">
  <p class="eyebrow"><span class="dot"></span>${esc(g.tag)} · ${esc(g.title)}</p>
  <h1>${esc(page.display)} — your whole business in one place</h1>
  <p class="tagline">A public website, your day-to-day office work, and AI coworkers that already speak your line of work — set up for you in minutes, on your own computers.</p>
  <p class="lede">${esc(page.who)}</p>
  <ul class="trust-badges" aria-label="At a glance">
    <li><span class="d"></span>Set up for your business</li>
    <li><span class="d"></span>You approve every action</li>
    <li><span class="d"></span>A record of everything</li>
    <li><span class="d"></span>Runs on your computers</li>
  </ul>
  <ul class="chips">${chips}</ul>
  <div class="cta-row">
    <a class="btn primary" href="/#install">Install the platform</a>
    <a class="btn" href="#choose-type">Choose your exact organization</a>
  </div>
</div></section>

<main class="wrap">

  <section id="choose-type" aria-label="Choose an exact organization type">
    <p class="section-eyebrow">Choose the work you actually do</p>
    <h2>One category, different operating models</h2>
    <p class="sub">These organizations share some concerns, but they do not share one value stream. Choose the closest match to see its current stages, constraints, and configured capabilities.</p>
    <div class="grid leaf-grid">
      ${leafCards}
    </div>
  </section>

  <section aria-label="Shared category concerns">
    <p class="section-eyebrow">Shared concerns — not a universal workflow</p>
    <h2>What this category has in common</h2>
    <p class="sub">${esc(page.model)} The exact operating flow belongs to each organization type above.</p>
  </section>

  <section aria-label="Problems and capabilities">
    <div class="twocol">
      <div>
        <p class="section-eyebrow">Common pressure points</p>
        <h2>Problems often seen here</h2>
        <ul class="tlist problems">
          ${problems}
        </ul>
      </div>
      <div>
        <p class="section-eyebrow">Profile patterns</p>
        <h2>What the category prepares for</h2>
        <ul class="tlist caps">
          ${caps}
        </ul>
      </div>
    </div>
  </section>

  ${compliance}

  <section aria-label="Definition evidence">
    <div class="evidence-note">
      <span class="badge">Shipped definition</span>
      <h2>Public detail comes from the installed archetype registry</h2>
      <p>The organization links above are generated from the same source definitions the platform uses. They are not a second hand-written value stream. <a href="https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/tree/main/packages/storefront-templates/src">Inspect the current definitions →</a></p>
    </div>
  </section>

  ${secondaryAudienceLinks()}

  <section aria-label="Get started">
    <div class="grid">
      <div class="card">
        <h3>Ready to set up your organization?</h3>
        <p style="margin-bottom:12px;">Install on your own computers, then choose the exact organization type that matches your work.</p>
        <a class="btn primary" href="/#install">Install</a>
        <a class="btn" href="/business-types/">All business types</a>
      </div>
    </div>
  </section>

  ${readabilityNote(page)}

</main>

${footer()}
<a class="back-top" href="#top" aria-label="Back to top">↑ Top</a>
</body>
</html>
`;
}

function canonicalLeafHTML(archetype) {
  const categoryPage = pageForArchetype.get(archetype.archetypeId);
  const model = deriveOperationalValueStream(archetype);
  const profile = archetype.activationProfile;
  const process = profile?.processProfile;
  const modules = profile?.modules ?? [];
  const trustGates = model.trustGates.length
    ? model.trustGates.map((gate) => `<li>${esc(gate.replaceAll("-", " "))}</li>`).join("")
    : "<li>No additional archetype-specific trust gate is declared.</li>";
  const moduleDetail = modules.length
    ? modules.map((module) => `<li><code>${esc(module)}</code></li>`).join("")
    : "<li>No optional operational modules are activated by this definition.</li>";
  const subjectLine = process?.subjectTypes?.length
    ? process.subjectTypes.join(", ")
    : "not specialized";
  const categoryHref = categoryPage
    ? `/business-types/${categoryPage.slug}.html`
    : "/business-types/";
  const categoryLabel = categoryPage?.display ?? archetype.category.replaceAll("-", " ");
  const stages = model.stages.map((stage) => ({ label: stage.label, key: stage.loadBearing }));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(archetype.name)} operating model — Open Digital Product Factory</title>
<meta name="description" content="The canonical DPF operating definition for ${esc(archetype.name)}: value-stream stages, constraints, demand pattern, and configured modules."/>
<link rel="stylesheet" href="/assets/css/business.css"/>
</head>
<body id="top" data-canonical-archetype-id="${esc(archetype.archetypeId)}">
${topbar()}

<section class="hero leaf-hero"><div class="wrap">
  <p class="eyebrow"><span class="dot"></span>${esc(categoryLabel)} · exact organization type</p>
  <h1>${esc(archetype.name)}</h1>
  <p class="tagline">See how this organization is defined in DPF today: the work stages, the load-bearing point, capacity, demand, and trust constraints.</p>
  <p class="lede">This is a generated projection of the installed archetype definition, not another hand-written operating model.</p>
  <div class="cta-row">
    <a class="btn primary" href="/#install">Install the platform</a>
    <a class="btn" href="${esc(categoryHref)}">Back to ${esc(categoryLabel)}</a>
  </div>
</div></section>

<main class="wrap">
  <section aria-label="Definition status">
    <div class="evidence-note">
      <span class="badge">Canonical projection · shipped definition</span>
      <h2>One source, two views</h2>
      <p>This page calls the same <code>deriveOperationalValueStream</code> projection used from the storefront archetype substrate. A generation check fails if this public page drifts from source. <a href="https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/tree/main/packages/storefront-templates/src">Inspect the source definition →</a></p>
    </div>
  </section>

  <section aria-label="Value stream">
    <p class="section-eyebrow">Current operating definition</p>
    <h2>The work from start to finish</h2>
    <p class="sub">Highlighted stages are the load-bearing points derived from this exact archetype profile.</p>
    ${vstreamStrip(stages, {
      top: model.trustGates.length ? `Trust gates: ${model.trustGates.join(", ")}` : "Governance and evidence across every stage",
      bottom: `Capacity: ${model.capacityUnit.replaceAll("-", " ")} · Demand: ${model.demandSignature.replaceAll("-", " ")}`,
    })}
  </section>

  <section aria-label="Operating facts">
    <p class="section-eyebrow">Definition facts</p>
    <h2>What shapes this flow</h2>
    <dl class="profile-facts">
      <div><dt>Primary public action</dt><dd>${esc(archetype.ctaType.replaceAll("-", " "))}</dd></div>
      <div><dt>Subject of the work</dt><dd>${esc(subjectLine)}</dd></div>
      <div><dt>Capacity constraint</dt><dd>${esc(model.capacityUnit.replaceAll("-", " "))}</dd></div>
      <div><dt>Demand pattern</dt><dd>${esc(model.demandSignature.replaceAll("-", " "))}</dd></div>
      <div><dt>Houses subjects</dt><dd>${process?.housesSubjects ? "Yes" : "No"}</dd></div>
      <div><dt>Schedules subjects</dt><dd>${process?.schedulesSubjects ? "Yes" : "No"}</dd></div>
    </dl>
  </section>

  <section aria-label="Constraints and configured modules">
    <div class="twocol">
      <div>
        <p class="section-eyebrow">Trust constraints</p>
        <h2>What cannot be skipped</h2>
        <ul class="plain-list">${trustGates}</ul>
      </div>
      <div>
        <p class="section-eyebrow">Definition evidence</p>
        <h2>Configured modules</h2>
        <ul class="plain-list">${moduleDetail}</ul>
      </div>
    </div>
  </section>

  <section aria-label="Product status">
    <div class="note"><strong>Definition versus delivery.</strong> This page proves what the archetype definition currently says. It does not claim that every domain workflow shown by the definition is complete in the running product. Future mobile experience is documented separately and labelled as vision.</div>
  </section>

  ${secondaryAudienceLinks()}
</main>

${footer()}
<a class="back-top" href="#top" aria-label="Back to top">↑ Top</a>
</body>
</html>
`;
}

// ---- hub page --------------------------------------------------------------
function hubHTML() {
  const grouped = pagesByGroup();
  const publicLeafCount = pageForArchetype.size;
  const groupSections = grouped
    .map((g) => {
      const cards = g.items
        .map((p) => {
          const preview = p.leaf.slice(0, 4).join(" · ") + (p.leaf.length > 4 ? " · …" : "");
          return `<a class="card linkcard" href="/business-types/${p.slug}.html">
          <h3>${esc(p.display)} <span class="arrow" aria-hidden="true">→</span></h3>
          <p>${esc(p.who)}</p>
          <p class="leafline">${esc(preview)}</p>
        </a>`;
        })
        .join("\n        ");
      return `<section class="group" id="g-${g.id}">
      <div class="group-head"><h2>${esc(g.title)}</h2><span class="gtag">${esc(g.tag)}</span></div>
      <p class="sub">${esc(g.blurb)}</p>
      <div class="grid">
        ${cards}
      </div>
    </section>`;
    })
    .join("\n\n    ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Find your business — Open Digital Product Factory</title>
<meta name="description" content="The Open Digital Product Factory reshapes itself to how your business actually works. Find your business type — field & dispatch, appointments, retail, members & community, or projects & rentals — and see the value, the model, and the capabilities."/>
<link rel="stylesheet" href="/assets/css/business.css"/>
</head>
<body id="top">
${topbar()}

<section class="hero"><div class="wrap">
  <p class="eyebrow"><span class="dot"></span>Find your business</p>
  <h1>Start with the organization you actually run</h1>
  <p class="lede">Choose a category, then drill into the exact organization type. Each detail page is generated from the same archetype definition used by DPF, so a category never pretends every member works the same way. This public guide currently covers ${pages.length} categories and ${publicLeafCount} exact organization types.</p>
  <div class="cta-row">
    <a class="btn primary" href="/#install">Install the platform</a>
    <a class="btn" href="#categories">Find your organization</a>
  </div>
</div></section>

<main class="wrap">

  <section aria-label="What operators get">
    ${calloutHTML()}
  </section>

  <p id="categories" class="section-eyebrow" style="margin-top:8px;">Grouped by shared concerns — exact workflows live one level down</p>

  ${groupSections}

  ${secondaryAudienceLinks()}

  <section aria-label="Get started">
    <div class="grid">
      <div class="card">
        <h3>Don’t see an exact match?</h3>
        <p style="margin-bottom:12px;">Install and choose the closest current definition. The public guide only claims the organization types it can project from source today.</p>
        <a class="btn primary" href="/#install">Install</a>
        <a class="btn" href="/">Back to overview</a>
      </div>
    </div>
  </section>

</main>

${footer()}
<a class="back-top" href="#top" aria-label="Back to top">↑ Top</a>
</body>
</html>
`;
}

function partnersHTML() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Partners and builders — Open Digital Product Factory</title>
<meta name="description" content="How resellers, builders, MSPs, and delivery partners package and support Open Digital Product Factory installs."/>
<link rel="stylesheet" href="/assets/css/business.css"/>
</head>
<body id="top">
${topbar()}
<section class="hero"><div class="wrap">
  <p class="eyebrow"><span class="dot"></span>Partner path</p>
  <h1>For resellers, builders, and delivery partners</h1>
  <p class="tagline">Package, configure, and support one governed platform for each client without mixing partner go-to-market language into the client’s own operating model.</p>
  <p class="lede">This path is for MSPs, consultants, integrators, and builders. Organization operators can stay in the business-type guide.</p>
  <div class="cta-row">
    <a class="btn primary" href="/#install">Install for a client</a>
    <a class="btn" href="/business-types/">See organization types</a>
  </div>
</div></section>
<main class="wrap">
  <section aria-label="Partner operating model">
    <p class="section-eyebrow">Repeatable delivery</p>
    <h2>One platform, one isolated install per client</h2>
    <div class="grid">
      <div class="card"><h3>Choose the client’s definition</h3><p>Start from the organization’s canonical archetype rather than a blank template or a generic commercial flow.</p></div>
      <div class="card"><h3>Configure and brand</h3><p>Apply the client’s identity, approved integrations, operating rules, and local constraints.</p></div>
      <div class="card"><h3>Support with evidence</h3><p>Keep changes, approvals, releases, and coworker actions traceable inside the client’s governed install.</p></div>
    </div>
  </section>
  <section aria-label="Partner evidence">
    <div class="evidence-note">
      <span class="badge">Partner material</span>
      <h2>Keep the client’s page about the client</h2>
      <p>Reseller packaging and platform go-to-market belong here. The operator-facing pages only carry small links to this route. <a href="https://github.com/OpenDigitalProductFactory/opendigitalproductfactory">Inspect the current platform source →</a></p>
    </div>
  </section>
  <section aria-label="Partner next steps">
    <div class="twocol">
      <div class="card"><h3>Need the technical model?</h3><p>Review how public pages project the canonical archetype registry and how drift is checked.</p><a class="more" href="/business-types/architecture.html">Open architecture →</a></div>
      <div class="card"><h3>Need the client’s operating model?</h3><p>Choose the exact organization type and share that operator-first page.</p><a class="more" href="/business-types/">Open business types →</a></div>
    </div>
  </section>
</main>
${footer()}
<a class="back-top" href="#top" aria-label="Back to top">↑ Top</a>
</body>
</html>
`;
}

function architectureHTML() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Archetype projection architecture — Open Digital Product Factory</title>
<meta name="description" content="How the public business-type guide projects DPF's canonical archetype and operational value-stream definitions, with automated drift checks."/>
<link rel="stylesheet" href="/assets/css/business.css"/>
</head>
<body id="top">
${topbar()}
<section class="hero"><div class="wrap">
  <p class="eyebrow"><span class="dot"></span>Architecture path</p>
  <h1>How archetype definitions become public pages</h1>
  <p class="tagline">The public guide is a read model over the platform’s canonical archetype registry. It does not maintain another value-stream definition.</p>
  <p class="lede">This path is for architects, standards reviewers, and contributors who need the source, projection, and conformance contract.</p>
  <div class="cta-row">
    <a class="btn primary" href="https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/tree/main/packages/storefront-templates/src">Inspect canonical source</a>
    <a class="btn" href="/business-types/">See the public projection</a>
  </div>
</div></section>
<main class="wrap">
  <section aria-label="Projection architecture">
    <p class="section-eyebrow">Single source of truth</p>
    <h2>Definition → derivation → public read model</h2>
    <div class="pipeline">
      <div class="pipe-stage src"><span class="pk">CANONICAL SOURCE</span><span class="pl">ArchetypeDefinition</span><code>packages/storefront-templates/src</code></div>
      <div class="pipe-arrow" aria-hidden="true"></div>
      <div class="pipe-stage"><span class="pk">PURE DERIVATION</span><span class="pl">Operational value stream</span><code>deriveOperationalValueStream</code></div>
      <div class="pipe-arrow" aria-hidden="true"></div>
      <div class="pipe-out">
        <div class="o">Internal architecture<span>governed model projection</span></div>
        <div class="o">Public leaf pages<span>operator-readable projection</span></div>
        <div class="o">Conformance check<span>regenerate and compare</span></div>
      </div>
    </div>
  </section>
  <section aria-label="Conformance contract">
    <div class="twocol">
      <div>
        <p class="section-eyebrow">Drift prevention</p>
        <h2>Generated pages are checked</h2>
        <p>The generator resolves every published leaf against <code>ALL_ARCHETYPES</code>, calls the canonical operational-value-stream derivation, and fails in <code>--check</code> mode when committed HTML differs.</p>
      </div>
      <div>
        <p class="section-eyebrow">Deliberate boundary</p>
        <h2>Category copy is only shared context</h2>
        <p>Category pages may explain common concerns. They do not define one category-wide process. Exact stages, constraints, and modules appear only on canonical leaf projections.</p>
      </div>
    </div>
  </section>
  <section aria-label="Current evidence">
    <div class="evidence-note">
      <span class="badge">Current evidence</span>
      <h2>${pageForArchetype.size} published leaf profiles resolve to source</h2>
      <p>The committed artifacts are generated from <code>packages/storefront-templates/src</code>. Broader platform architecture and standards remain in the <a href="/architecture/platform-overview">architecture documentation</a>.</p>
    </div>
  </section>
  ${standardsSection()}
  ${secondaryAudienceLinks()}
</main>
${footer()}
<a class="back-top" href="#top" aria-label="Back to top">↑ Top</a>
</body>
</html>
`;
}

// ---- deterministic artifact set + drift check ------------------------------
function readabilityResult() {
  const scored = pages
    .map((p) => ({ slug: p.slug, ...analyze(businessCopy(p)) }))
    .sort((a, b) => b.gradeLevel - a.gradeLevel);
  const failing = scored.filter((s) => s.gradeLevel > READING_TARGET);
  const mean = (scored.reduce((n, s) => n + s.gradeLevel, 0) / scored.length).toFixed(1);
  const report =
    `# Readability report — business-facing copy\n\n` +
    `Metric: Flesch–Kincaid (the test Microsoft Word reports). Target: Grade ≤ ${READING_TARGET} ` +
    `(high-school, plain English). Architecture and partner pages are scored under their own audience tiers and excluded here.\n\n` +
    `Mean Grade: **${mean}** · within target: **${scored.length - failing.length}/${scored.length}**\n\n` +
    `| Page | Grade | Reading ease | Words/sentence | Band |\n|---|---|---|---|---|\n` +
    scored
      .map((s) => `| ${s.slug} | ${s.gradeLevel} | ${s.readingEase} | ${s.wordsPerSentence} | ${band(s.gradeLevel)} |`)
      .join("\n") +
    `\n`;
  return { scored, failing, mean, report };
}

export function buildOutputs() {
  const outputs = new Map();
  outputs.set("index.html", hubHTML());
  outputs.set("partners.html", partnersHTML());
  outputs.set("architecture.html", architectureHTML());
  for (const page of pages) {
    outputs.set(`${page.slug}.html`, pageHTML(page));
    for (const archetype of resolveCanonicalLeaves(page)) {
      const processModel = leafProcesses.find(
        (candidate) => candidate.archetypeId === archetype.archetypeId,
      );
      outputs.set(
        `archetypes/${archetype.archetypeId}.html`,
        processModel ? leafProcessPageHTML(processModel, page.slug) : canonicalLeafHTML(archetype),
      );
    }
  }
  outputs.set("_readability-report.md", readabilityResult().report);
  return outputs;
}

export function unexpectedLeafArtifacts(outputs, existingLeafFiles) {
  return existingLeafFiles
    .filter((file) => file.endsWith(".html") && !outputs.has(`archetypes/${file}`))
    .map((file) => `archetypes/${file}`)
    .sort();
}

function writeOrCheckOutputs(outputs, checkOnly) {
  const stale = [];
  for (const [relativePath, content] of outputs) {
    const outputPath = join(__dirname, relativePath);
    if (checkOnly) {
      if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== content) stale.push(relativePath);
      continue;
    }
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, content, "utf8");
  }
  if (checkOnly) {
    const leafDirectory = join(__dirname, "archetypes");
    const existingLeafFiles = existsSync(leafDirectory) ? readdirSync(leafDirectory) : [];
    stale.push(...unexpectedLeafArtifacts(outputs, existingLeafFiles));
  }
  if (stale.length) {
    console.error(`Public archetype projection is stale: ${stale.join(", ")}`);
    process.exitCode = 1;
  }
  return stale;
}

function printReadability(result) {
  console.log(`\nReadability of business-facing copy (target ≤ Grade ${READING_TARGET}):`);
  for (const score of result.scored) {
    const flag = score.gradeLevel > READING_TARGET ? "  ✗ OVER" : "  ✓";
    console.log(`  ${score.slug.padEnd(34)} Grade ${String(score.gradeLevel).padStart(4)}  ease ${String(score.readingEase).padStart(4)}  ${band(score.gradeLevel)}${flag}`);
  }
  console.log(`  mean Grade ${result.mean} · ${result.scored.length - result.failing.length}/${result.scored.length} within target`);
  if (result.failing.length) {
    console.warn(`\n⚠  ${result.failing.length} page(s) above the high-school target: ${result.failing.map((f) => `${f.slug} (${f.gradeLevel})`).join(", ")}`);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
export function generateBusinessTypeOutputs(checkOnly = false) {
  const outputs = buildOutputs();
  const stale = writeOrCheckOutputs(outputs, checkOnly);
  const pageCount = Array.from(outputs.keys()).filter((path) => path.endsWith(".html")).length;
  if (checkOnly && stale.length === 0) {
    console.log(`Public archetype projection is current (${pageCount} HTML pages).`);
  } else if (!checkOnly) {
    console.log(`Generated ${pageCount} HTML pages into ${__dirname}.`);
  }
  printReadability(readabilityResult());
  return stale;
}

if (invokedPath === fileURLToPath(import.meta.url)) {
  generateBusinessTypeOutputs(process.argv.includes("--check"));
}
