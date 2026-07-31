// ============================================================================
// Generator for the /business-types/ hub + per-business pages.
// Run from this directory:   node _generate.mjs
// Emits: index.html (hub) and one <slug>.html per business type.
// Files starting with "_" are ignored by Jekyll, so this script + the content
// module are never published — only the HTML they produce.
// ============================================================================

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { groups, pages, pagesByGroup, groupMock, judgement } from "./_content.mjs";
import { analyze, band, TIERS } from "./_readability.mjs";

// Target reading level for BUSINESS-FACING copy — the "archetype" tier of the
// platform readability policy (high-school, plain English). Technical sections
// (standards, archetype-engine internals) are the "architecture" tier (uncapped).
const READING_TARGET = TIERS.archetype.maxGrade;

const __dirname = dirname(fileURLToPath(import.meta.url));

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ---- per-group "operating model" parameters (drive the SVG diagram) --------
const OP = {
  field: {
    customerSub: "needs a job done",
    channel: "requests a job",
    opModel: "Dispatch board routes the right tech to the address",
    deliver: "delivers on-site",
    valueTitle: "Job done on-site",
    valueSub: "Field invoice",
    retain: "Maintenance plans & recalls bring them back",
    trust: "licensing & safety where the trade requires it",
  },
  book: {
    customerSub: "wants a time slot",
    channel: "books a time",
    opModel: "Per-provider calendar with real availability",
    deliver: "delivers the service",
    valueTitle: "The appointment",
    valueSub: "Pay at the visit",
    retain: "Rebooking & recall nudges bring them back",
    trust: "the right vocabulary — patients, clients, members",
  },
  sell: {
    customerSub: "browses & buys",
    channel: "adds to cart",
    opModel: "Catalogue → cart → checkout that never drops",
    deliver: "fulfils & delivers",
    valueTitle: "The order",
    valueSub: "Order invoice",
    retain: "Accounts recognise repeat buyers",
    trust: "images, pricing & delivery details intact",
  },
  members: {
    customerSub: "applies · donates · requests",
    channel: "applies or gives",
    opModel: "Eligibility & disclosure gate, then the service",
    deliver: "delivers",
    valueTitle: "Service or benefit",
    valueSub: "Receipt or statutory fee — never a hard sell",
    retain: "Renewal, patronage & recall",
    trust: "trust gate first — KYC, disclosures, serve everyone",
  },
  build: {
    customerSub: "inquires or reserves",
    channel: "inquires / reserves",
    opModel: "Quote · agreement · project or rental period",
    deliver: "delivers over time",
    valueTitle: "The engagement",
    valueSub: "Milestone or usage billing",
    retain: "Renew the agreement for the next project",
    trust: "scope, estate isolation & duty of care",
  },
  // Generic set used for the hub's universal-backbone diagram.
  universal: {
    customerSub: "a stranger with a need",
    channel: "is captured",
    opModel: "Your business, reshaped to how it actually runs",
    deliver: "delivers value",
    valueTitle: "Value delivered",
    valueSub: "Money recognised truthfully",
    retain: "The relationship persists & compounds",
    trust: "you approve every step — and it's all logged",
  },
};

// ---- text wrapping for SVG -------------------------------------------------
function wrap(str, max = 24, maxLines = 3) {
  const words = String(str).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur.trim());
  if (lines.length > maxLines) {
    const head = lines.slice(0, maxLines - 1);
    head.push(lines.slice(maxLines - 1).join(" "));
    return head;
  }
  return lines;
}

function tspans(cx, cy, lines, { lh = 15, cls = "" } = {}) {
  const startY = cy - ((lines.length - 1) * lh) / 2;
  return lines
    .map(
      (ln, i) =>
        `<text x="${cx}" y="${startY + i * lh}" text-anchor="middle" dominant-baseline="middle"${
          cls ? ` class="${cls}"` : ""
        }>${esc(ln)}</text>`
    )
    .join("");
}

// ---- the operating-model SVG (compact, scales well on mobile) --------------
// Customer → [Your business on DPF] → Value+money, coworker feeds the middle,
// a governance lane sits on top, and a retain loop curves back to the customer.
function operatingModelSVG(groupId, title) {
  const o = OP[groupId] || OP.universal;
  const W = 720,
    H = 330;
  const A = { x: 24, y: 92, w: 150, h: 92 }; // customer
  const B = { x: 250, y: 78, w: 200, h: 120 }; // your business
  const C = { x: 526, y: 92, w: 170, h: 92 }; // value + money
  const cw = { x: 250, y: 232, w: 200, h: 56 }; // coworker
  const cxA = A.x + A.w / 2,
    cxB = B.x + B.w / 2,
    cxC = C.x + C.w / 2,
    cxCw = cw.x + cw.w / 2;
  const mid = 138; // arrow row y

  // Colours come from a scoped <style> block (CSS), NOT presentation attributes
  // — var()/color-mix() only resolve in CSS, so attribute fills would break the
  // dark theme. Every selector is prefixed with `.om` (the svg's class).
  return `<svg viewBox="0 0 ${W} ${H}" class="om" role="img" aria-labelledby="omt omd">
  <title id="omt">How a ${esc(title)} business runs on DPF</title>
  <desc id="omd">The customer engages your business, which runs on DPF; value is delivered and money recognised, an AI coworker assists, the whole flow is governed, and the relationship loops back.</desc>
  <style>
    .om{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px}
    .om text{fill:var(--fg)}
    .om .muted{fill:var(--fg-muted)}
    .om .node{fill:var(--surface-2);stroke:var(--border);stroke-width:1}
    .om .node.acc{fill:color-mix(in srgb,var(--accent) 13%,var(--surface));stroke:var(--accent);stroke-width:2}
    .om .node.acc2{fill:color-mix(in srgb,var(--accent-2) 13%,var(--surface));stroke:var(--accent-2);stroke-width:1.5}
    .om .lane{fill:none;stroke:var(--border);stroke-dasharray:4 4}
    .om .eb{font-size:10px;font-weight:700;letter-spacing:1.2px}
    .om .eb.a{fill:var(--accent)} .om .eb.g{fill:var(--good)} .om .eb.t{fill:var(--accent-2)}
    .om .flow{stroke:var(--accent-3);stroke-width:2;fill:none}
    .om .flow.dash{stroke-dasharray:5 4}
    .om .cwflow{stroke:var(--accent-2);stroke-width:2;fill:none}
    .om .ah{fill:var(--accent-3)}
  </style>
  <defs>
    <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="ah"/>
    </marker>
  </defs>

  <rect x="16" y="14" width="${W - 32}" height="30" rx="8" class="lane"/>
  <text x="${W / 2}" y="29" text-anchor="middle" font-size="11.5" font-weight="600" class="muted">You approve every step · ${esc(o.trust)}</text>

  <rect x="${A.x}" y="${A.y}" width="${A.w}" height="${A.h}" rx="12" class="node"/>
  <text x="${cxA}" y="${A.y + 20}" text-anchor="middle" class="eb a">CUSTOMER</text>
  ${tspans(cxA, A.y + 56, wrap(o.customerSub, 18, 2), { lh: 15 })}

  <rect x="${B.x}" y="${B.y}" width="${B.w}" height="${B.h}" rx="12" class="node acc"/>
  <text x="${cxB}" y="${B.y + 22}" text-anchor="middle" class="eb a">YOUR BUSINESS · ON DPF</text>
  ${tspans(cxB, B.y + 64, wrap(o.opModel, 26, 3), { lh: 16 })}

  <rect x="${C.x}" y="${C.y}" width="${C.w}" height="${C.h}" rx="12" class="node"/>
  <text x="${cxC}" y="${C.y + 20}" text-anchor="middle" class="eb g">VALUE + MONEY</text>
  ${tspans(cxC, C.y + 48, wrap(o.valueTitle, 18, 2), { lh: 15 })}
  <text x="${cxC}" y="${C.y + C.h - 14}" text-anchor="middle" font-size="11" class="muted">${esc(o.valueSub)}</text>

  <rect x="${cw.x}" y="${cw.y}" width="${cw.w}" height="${cw.h}" rx="12" class="node acc2"/>
  <text x="${cxCw}" y="${cw.y + 22}" text-anchor="middle" class="eb t">AI COWORKER</text>
  <text x="${cxCw}" y="${cw.y + 40}" text-anchor="middle" font-size="12">speaks your language, not jargon</text>

  <line x1="${A.x + A.w}" y1="${mid}" x2="${B.x - 6}" y2="${mid}" class="flow" marker-end="url(#ah)"/>
  <text x="${(A.x + A.w + B.x) / 2}" y="128" text-anchor="middle" font-size="10.5" class="muted">${esc(o.channel)}</text>

  <line x1="${B.x + B.w}" y1="${mid}" x2="${C.x - 6}" y2="${mid}" class="flow" marker-end="url(#ah)"/>
  <text x="${(B.x + B.w + C.x) / 2}" y="128" text-anchor="middle" font-size="10.5" class="muted">${esc(o.deliver)}</text>

  <line x1="${cxCw}" y1="${cw.y}" x2="${cxCw}" y2="${B.y + B.h + 6}" class="cwflow" marker-end="url(#ah)"/>

  <path d="M ${cxC} ${C.y + C.h} C ${cxC} 312, ${cxA} 312, ${cxA} ${A.y + A.h + 6}" class="flow dash" marker-end="url(#ah)"/>
  <text x="${W / 2}" y="322" text-anchor="middle" font-size="10.5" class="muted">${esc(o.retain)}</text>
</svg>`;
}

// ---- value-stream strip (CSS, reflows vertical on mobile) ------------------
function vstreamStrip(stages) {
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
      <p class="vstream-lane">Trust &amp; licence checks — across every step</p>
      <ul class="vstream">
        ${items}
      </ul>
      <p class="vstream-lane bottom">Your AI coworker — turns enquiries into work, in your words</p>
    </div>`;
}

// ---- mobile vision callout (honest: foundation real, app not yet shipped) --
function mobileLead(page) {
  return page.mobile
    ? `For ${page.display.toLowerCase()}, the phone is where the work happens. We want a field app that shows the next job, maps the way there, takes photos and a signature, and makes the invoice on the spot — even with no signal.`
    : `Even when the work isn’t in the field, you are. We want a pocket app that pings you when a coworker needs a yes or no on a risky step, and lets your customers book, track, and pay from your own branded app.`;
}
function mobileVisionCard(page) {
  return `<div class="vision">
        <span class="badge">Vision · not yet shipped</span>
        <h3>The mobile app — where this gets even better</h3>
        <p>${esc(mobileLead(page))}</p>
        <p>One generic native iOS/Android app (published by Arcamanus&nbsp;LLC) that connects to your own install and lets the platform drive its look and features — so field techs, customers, and you each get the right screens without a separate app per business.</p>
        <p class="status"><strong>Where it stands today:</strong> the foundation is real and in the codebase — a React&nbsp;Native/Expo app shell (native shell + install manifest + offline form/screen renderer), a REST API, and secure sign-in. The end-user experience — persona-aware screens, connecting one app to any install, push notifications, and App&nbsp;Store / Play delivery — is the next phase and <strong>not yet available</strong>. We’re building toward field dispatch and owner approvals first.</p>
      </div>`;
}
function mobileVision(page) {
  return `<section aria-label="Mobile vision">
      ${mobileVisionCard(page)}
    </section>`;
}

// ---- shared chrome ---------------------------------------------------------
function topbar() {
  return `<header class="topbar"><div class="wrap topbar-inner">
    <a class="topbar-brand" href="/"><img src="/assets/logos/OpenDigitalProductFactory.png" alt="" width="934" height="688"/>Open Digital Product Factory</a>
    <nav class="topbar-nav" aria-label="Primary">
      <a href="/business-types/">All business types</a>
      <a href="#archetype-engine">Architecture</a>
      <a href="#standards">Standards</a>
      <a href="#resell">Resellers</a>
      <a href="/#install">Install</a>
    </nav>
  </div></header>`;
}

function footer() {
  return `<footer class="site"><div class="wrap">
    <p>Open Digital Product Factory · <a href="/">Home</a> · <a href="/business-types/">All business types</a> · <a href="https://github.com/OpenDigitalProductFactory/opendigitalproductfactory">GitHub repository</a></p>
    <p class="muted" style="margin:6px 0 0; font-size:13px;">Internally, each business type is seeded from a market <em>archetype</em> — the single source of truth that shapes the storefront, vocabulary, scheduling, finance, and compliance defaults. <a href="/#archetypes">More for builders &amp; resellers →</a></p>
  </div></footer>`;
}

// ---- core-message callout --------------------------------------------------
function calloutHTML() {
  return `<div class="callout">
      <p class="ck">In plain terms</p>
      <p>One install gives you a <b>website your customers can use</b>, a <b>place to run the work</b>, and <b>AI coworkers that already speak your line of work</b>. You approve the important moves, and everything stays on your own computers.</p>
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

// ---- audience split (Use it · Resell it · Understand it) --------------------
const USE_LINE = {
  field: "Capture urgent jobs, dispatch the right technician, hold maintenance plans, and invoice from the field.",
  book: "Fill the calendar with the right people, keep the records on hand, and nudge the rebooking.",
  sell: "Turn a catalogue into orders without dropping a product image, a price, or a delivery detail.",
  members: "Take applications, donations, and requests through a trust gate — and account for every fee or receipt.",
  build: "Move from inquiry to proposal to milestone billing, with each client’s estate kept clean and isolated.",
};
function audienceSplit(page) {
  return `<section id="audiences" aria-label="Three audiences">
    <p class="section-eyebrow">Three ways in</p>
    <h2>Use it · Resell it · Understand it</h2>
    <div class="audience-split">
      <div class="aud use">
        <div class="role">Use it</div>
        <h3>Run your ${esc(page.display.toLowerCase())} business</h3>
        <p>${esc(USE_LINE[page.group])}</p>
        <a class="more" href="#how">See the value &amp; capabilities &darr;</a>
        <div class="who">For owners &amp; operators</div>
      </div>
      <div class="aud resell">
        <div class="role">Resell it</div>
        <h3>Package it for clients</h3>
        <p>One platform you set up per client — brand it, support it, repeat for the next client. No custom app each time.</p>
        <a class="more" href="#resell">Explore the reseller path &darr;</a>
        <div class="who">For partners, MSPs &amp; consultants</div>
      </div>
      <div class="aud understand">
        <div class="role">Understand it</div>
        <h3>Inspect the architecture</h3>
        <p>How it's built, how every AI action is approved and logged, and where it stands against emerging AI-agent standards — auditable, not a black box.</p>
        <a class="more" href="#for-builders">See under the hood &darr;</a>
        <div class="who">For architects &amp; standards reviewers</div>
      </div>
    </div>
  </section>`;
}

// ---- archetype engine (the architectural invention) ------------------------
function archetypeEngine(page) {
  return `<section id="archetype-engine" aria-label="The archetype engine">
    <p class="section-eyebrow">How it's built</p>
    <h2>One business type generates the whole setup</h2>
    <p class="sub">The business type you pick at setup is the single source of truth (<code>StorefrontConfig.archetypeId</code> in the data model). From it, DPF generates the public website wording, scheduling defaults, finance assumptions, licence hints, the words each AI coworker uses, and the direction of the mobile app — which is how one platform covers many business types without a custom app for each. <em>(For builders, the precise internal term is the “archetype”.)</em></p>
    <div class="pipeline">
      <div class="pipe-stage src"><span class="pk">SOURCE OF TRUTH</span><span class="pl">Business type</span><code>StorefrontConfig.archetypeId</code></div>
      <div class="pipe-arrow" aria-hidden="true"></div>
      <div class="pipe-stage"><span class="pk">DERIVES</span><span class="pl">Generated setup</span><code>activationProfile · axes · vocabulary</code></div>
      <div class="pipe-arrow" aria-hidden="true"></div>
      <div class="pipe-out">
        <div class="o">Storefront<span>intake, CTAs, sections</span></div>
        <div class="o">AI coworker<span>vocabulary, tools, routing</span></div>
        <div class="o">Workflows<span>scheduling, finance, compliance</span></div>
        <div class="o">Mobile manifest<span>capability direction (vision)</span></div>
      </div>
    </div>
    <div class="proof-grid" style="margin-top:18px;">
      ${wizardMock(page)}
      ${storefrontMock(page)}
    </div>
  </section>`;
}

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

// ---- product-evidence mockups (theme-aware HTML, not screenshots) ----------
function wizardMock(page) {
  const sibs = pages.filter((p) => p.group === page.group && p.slug !== page.slug).map((p) => p.display);
  const opts = [page.display, ...sibs].slice(0, 4);
  let i = 0;
  while (opts.length < 4) {
    const cand = pages[i++].display;
    if (!opts.includes(cand)) opts.push(cand);
  }
  const rows = opts
    .map((o, idx) =>
      idx === 0
        ? `<div class="mk-opt sel"><span class="rb"></span>${esc(o)}<span class="chk">✓</span></div>`
        : `<div class="mk-opt"><span class="rb"></span>${esc(o)}</div>`
    )
    .join("");
  return `<div class="frame mk-wizard">
    <div class="frame-bar"><span class="dots"><i></i><i></i><i></i></span><span class="ftitle">Setup · choose your business</span></div>
    <div class="frame-body"><p class="step">Step 2 of 5 · What kind of business is this?</p>${rows}</div>
    <p class="frame-cap">Your choice becomes <code>StorefrontConfig.archetypeId</code> — everything else generates from it.</p>
  </div>`;
}
function storefrontMock(page) {
  const m = groupMock[page.group];
  const tiles = m.services.map(([n, p]) => `<div class="mk-tile">${n}<div class="price">${p}</div></div>`).join("");
  return `<div class="frame mk-store">
    <div class="frame-bar"><span class="dots"><i></i><i></i><i></i></span><span class="ftitle">yourbusiness.example</span><span class="ftag">Generated</span></div>
    <div class="frame-body">
      <div class="sf-hero"><b>${m.storeHero.title}</b><span>${m.storeHero.sub}</span></div>
      <div class="mk-tiles">${tiles}</div>
      <span class="mk-cta">${m.storeCta}</span>
    </div>
    <p class="frame-cap">Public storefront, vocabulary and CTA generated from the archetype — no page-building.</p>
  </div>`;
}
function boardMock(page) {
  const m = groupMock[page.group];
  const cols = m.boardCols
    .map((c, idx) => {
      const job = m.boardJobs[idx];
      const chip = job ? `<div class="mk-job">${job[1] ? `<span class="u">${job[1]}</span> ` : ""}${job[0]}</div>` : "";
      return `<div class="col"><h5>${c}</h5>${chip}</div>`;
    })
    .join("");
  return `<div class="frame">
    <div class="frame-bar"><span class="dots"><i></i><i></i><i></i></span><span class="ftitle">Operations · work board</span></div>
    <div class="frame-body"><div class="mk-board">${cols}</div></div>
    <p class="frame-cap">The internal workspace home — demand becomes routed, trackable work.</p>
  </div>`;
}
function chatMock(page) {
  const m = groupMock[page.group];
  const acts = m.chat.actions.map((a, idx) => `<span class="a ${idx === 0 ? "approve" : "gate"}">${a}</span>`).join("");
  return `<div class="frame">
    <div class="frame-bar"><span class="dots"><i></i><i></i><i></i></span><span class="ftitle">AI coworker</span><span class="ftag">Proposal-gated</span></div>
    <div class="frame-body"><div class="mk-chat">
      <div class="mk-bubble user">${m.chat.q}</div>
      <div class="mk-bubble bot"><span class="agent">${m.chat.agent}</span>${m.chat.a}<div class="mk-actions">${acts}</div></div>
    </div></div>
    <p class="frame-cap">The coworker proposes; nothing consequential happens until you approve.</p>
  </div>`;
}
function agentCardMock(page) {
  const c = groupMock[page.group].card;
  const stateHtml = c.state === "pending" ? `<span class="pend">● awaiting approval</span>` : `<span class="ok">● clean</span>`;
  const row = (l, v) => `<div class="row"><span class="lab">${l}</span><span class="val">${v}</span></div>`;
  return `<div class="frame mk-card">
    <div class="frame-bar"><span class="dots"><i></i><i></i><i></i></span><span class="ftitle">Authority &amp; Audit · Agent Card</span><span class="ftag">TAK · GAID-direction</span></div>
    <div class="frame-body">
      ${row("Agent", `<code>${c.agent}</code>`)}
      ${row("Route", c.route)}
      ${row("Tool grants", c.grants)}
      ${row("HITL tier", c.hitl)}
      ${row("Mode", c.mode)}
      ${row("Last action", c.last)}
      ${row("Receipt", stateHtml)}
    </div>
    <p class="frame-cap">A supervisor-ready snapshot: who the agent is, what it may touch, and the evidence behind its last action.</p>
  </div>`;
}
function phoneMock(page) {
  const p = groupMock[page.group].phone;
  const btns = p.btns.map((b, idx) => `<span class="pbtn ${idx === p.btns.length - 1 ? "go" : ""}">${b}</span>`).join("");
  return `<div class="mk-phone-wrap"><div class="mk-phone">
    <span class="vribbon">Vision</span>
    <div class="notch"></div>
    <p class="scr-title">${p.title}</p>
    <div class="mk-pcard"><b>${p.cardTitle}</b><span class="meta">${p.meta}</span><div class="pbtns">${btns}</div></div>
  </div></div>`;
}
function proofVisuals(page) {
  return `<section id="proof" aria-label="A look at the screens">
    <p class="section-eyebrow">What it looks like</p>
    <h2>A look at the real screens</h2>
    <p class="sub">A few of the screens a ${esc(
      page.display.toLowerCase()
    )} business actually uses — the work board, and an AI coworker proposing the next move. Nothing happens until you approve it.</p>
    <div class="proof-grid">
      ${boardMock(page)}
      ${chatMock(page)}
    </div>
  </section>`;
}

// ---- partners / reseller band ----------------------------------------------
function partnersBand(page) {
  return `<section id="resell" aria-label="For partners and resellers">
    <p class="section-eyebrow">For partners, MSPs &amp; consultants</p>
    <h2>A repeatable vertical you can resell</h2>
    <div class="band">
      <div>
        <h3>Package once, deploy per client.</h3>
        <p>DPF turns a business type into a complete, ready-to-run setup. Instead of building a custom app for every client, you install one platform, pick the business type, brand it, and support it — the same way for the next ${esc(
          page.display.toLowerCase()
        )} client and the one after that.</p>
        <a class="btn primary" href="https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/CONTRIBUTING.md">Partner &amp; contribution path</a>
      </div>
      <ul class="ticks">
        <li>Archetype-based configuration, not custom code per client</li>
        <li>Local install on the client’s own hardware — you own the support relationship</li>
        <li>Reusable industry patterns shared through the opt-in Hive Mind</li>
        <li>Governed coworkers and audit trails regulated-sector clients require</li>
      </ul>
    </div>
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

// ---- how the coworker decides ----------------------------------------------
// Every business type is judged on the same named set of decision axes; only
// the emphasis changes. This block says what carries the most weight here and
// what is never traded away, then links to the full per-business-type detail
// and the axis definitions behind it.
function judgementSection(page) {
  const j = judgement[page.slug];
  if (!j) return "";
  return `<section id="decisions" aria-label="How your coworker decides">
    <p class="section-eyebrow">How your coworker decides</p>
    <h2>What it weighs, and what it will not trade</h2>
    <p class="sub">Your AI coworkers judge every call against the same named set of factors, whatever the business. What changes for ${esc(
      page.display.toLowerCase()
    )} is which of them carry the most weight.</p>
    <ul class="tlist caps">
      <li><span class="ic" aria-hidden="true">✓</span><span class="tx"><span class="lead">Weighs most heavily</span> ${esc(
        j.weighs
      )}</span></li>
      <li><span class="ic" aria-hidden="true">✓</span><span class="tx"><span class="lead">Never traded away</span> ${esc(
        j.never
      )}</span></li>
    </ul>
    <p class="sub">Every factor is named, and every principle's vote is recorded, so you can always ask why. See <a href="/architecture/decision-vectors-by-archetype#${esc(
      page.slug
    )}">the full detail for ${esc(
    page.display.toLowerCase()
  )}</a>, or the <a href="/architecture/decision-vectors">complete list of decision factors</a> and where each one's weight comes from.</p>
  </section>`;
}

// ---- per-business page -----------------------------------------------------
function pageHTML(page) {
  const g = groups.find((x) => x.id === page.group);
  const chips = page.leaf.map((l) => `<li class="chip">${esc(l)}</li>`).join("");
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
  const judged = judgementSection(page);

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
    <a class="btn" href="#how">See what you get</a>
    <a class="btn" href="#for-builders">For resellers &amp; builders</a>
  </div>
</div></section>

<main class="wrap">

  <section aria-label="The bigger picture">
    ${calloutHTML()}
  </section>

  ${audienceSplit(page)}

  <section id="how" aria-label="How the work flows">
    <p class="section-eyebrow">How the work flows</p>
    <h2>How a ${esc(page.display.toLowerCase())} business works</h2>
    <p class="sub">${esc(page.model)}</p>
    <div class="opmodel">
      <div class="diagram-scroll">${operatingModelSVG(page.group, page.display)}</div>
      <p class="scroll-hint">Scroll the diagram sideways to read every stage →</p>
      <p class="legend">DPF sets all this up for you out of the box — your public website, the words your AI coworker uses, your scheduling, your pricing, and the licence checks you need all come ready.</p>
    </div>
  </section>

  <section aria-label="Value stream">
    <p class="section-eyebrow">Start to finish</p>
    <h2>Your work, one step at a time</h2>
    <p class="sub">Every business finds customers, takes the work, does the job, gets paid, and keeps them coming back. What changes is the step that makes or breaks <em>your</em> kind of business — highlighted below.</p>
    ${vstreamStrip(page.stages)}
  </section>

  <section aria-label="Problems and capabilities">
    <div class="twocol">
      <div>
        <p class="section-eyebrow">The pain today</p>
        <h2>Problems we solve</h2>
        <ul class="tlist problems">
          ${problems}
        </ul>
      </div>
      <div>
        <p class="section-eyebrow">Out of the box · each tied to a part of DPF</p>
        <h2>What DPF gives you</h2>
        <ul class="tlist caps">
          ${caps}
        </ul>
      </div>
    </div>
  </section>

  ${proofVisuals(page)}

  ${judged}

  ${compliance}

  <section id="mobile" aria-label="Mobile vision">
    <div class="proof-grid" style="align-items:start;">
      <div>${mobileVisionCard(page)}</div>
      ${phoneMock(page)}
    </div>
  </section>

  <section id="for-builders" aria-label="For builders, resellers and architects">
    <div style="border-top:1px solid var(--border); padding-top:30px;">
      <p class="section-eyebrow">For builders, resellers &amp; architects</p>
      <h2>Under the hood — how DPF builds this</h2>
      <p class="sub">The rest of this page is the technical detail for people who extend, resell, or evaluate the platform. In one line: one install becomes a governed system for your whole business — the business type shapes everything, every AI action is approved and logged (the <strong>TAK</strong> runtime), and each AI coworker carries a checkable identity and an evidence trail (<strong>GAID</strong>). Most owners can stop above.</p>
    </div>
  </section>

  ${archetypeEngine(page)}

  ${standardsSection()}

  <section aria-label="Authority and audit evidence">
    <p class="section-eyebrow">For architects · the evidence trail</p>
    <h2>Every AI action is identified and logged</h2>
    <p class="sub">A supervisor-ready snapshot of any coworker: who it is, what it may touch, the mode it runs in, and the evidence behind its last action.</p>
    ${agentCardMock(page)}
  </section>

  ${partnersBand(page)}

  <section aria-label="Get started">
    <div class="grid">
      <div class="card">
        <h3>Ready to see it for your business?</h3>
        <p style="margin-bottom:12px;">Install on your own computers in minutes — the setup asks one question and sets up everything else for ${esc(
          page.display.toLowerCase()
        )} automatically.</p>
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

// ---- hub page --------------------------------------------------------------
function hubHTML() {
  const grouped = pagesByGroup();
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
  <h1>Built for how your business actually works</h1>
  <p class="lede">DPF isn’t a blank tool you configure for weeks. Pick what you do and the whole platform — your public storefront, the words your AI coworkers use, your scheduling, your finances, your compliance defaults — reshapes itself to match. Fifteen market categories and 56 ready business types ship in the box.</p>
  <div class="cta-row">
    <a class="btn primary" href="/#install">Install the platform</a>
    <a class="btn" href="#archetype-engine">Inspect the architecture</a>
    <a class="btn" href="#standards">Standards posture</a>
  </div>
</div></section>

<main class="wrap">

  <section aria-label="The bigger picture">
    ${calloutHTML()}
  </section>

  <section aria-label="The universal model">
    <p class="section-eyebrow">One backbone, many shapes</p>
    <h2>Every small business runs the same five moves</h2>
    <p class="sub">Attract someone, capture their intent, deliver the thing they pay for, account for the money, and keep the relationship. What differs is <em>which</em> move is make-or-break — and DPF tunes itself to that for each business below.</p>
    <div class="opmodel">
      <div class="diagram-scroll">${operatingModelSVG("universal", "small")}</div>
      <p class="scroll-hint">Scroll the diagram sideways →</p>
      <p class="legend">The same governed backbone underneath; a different load-bearing stage on top. That’s why a salon, a plumber, a credit union, and a food bank each get a platform that feels purpose-built.</p>
    </div>
  </section>

  <p class="section-eyebrow" style="margin-top:8px;">Grouped by how you operate — not by industry jargon</p>

  ${groupSections}

  <section id="for-builders" aria-label="For builders, resellers and architects">
    <div style="border-top:1px solid var(--border); padding-top:30px;">
      <p class="section-eyebrow">For builders, resellers &amp; architects</p>
      <h2>Under the hood</h2>
      <p class="sub">Everything above is for the people running a business. The rest is the technical detail for those who extend, resell, or evaluate the platform.</p>
    </div>
  </section>

  <section id="archetype-engine" aria-label="How it's built">
    <p class="section-eyebrow">How it's built</p>
    <h2>One business type generates the whole setup</h2>
    <p class="sub">The business type you pick at setup is the single source of truth (<code>StorefrontConfig.archetypeId</code> in the data model). From it, DPF generates the website wording, scheduling defaults, finance assumptions, licence hints, the words each AI coworker uses, and the direction of the mobile app — which is how one platform covers ${pages.length} business types without a custom app for each. <em>(For builders, the precise internal term is the “archetype”.)</em></p>
    <div class="pipeline">
      <div class="pipe-stage src"><span class="pk">SOURCE OF TRUTH</span><span class="pl">Business type</span><code>StorefrontConfig.archetypeId</code></div>
      <div class="pipe-arrow" aria-hidden="true"></div>
      <div class="pipe-stage"><span class="pk">DERIVES</span><span class="pl">Generated setup</span><code>activationProfile · axes · vocabulary</code></div>
      <div class="pipe-arrow" aria-hidden="true"></div>
      <div class="pipe-out">
        <div class="o">Storefront<span>intake, CTAs, sections</span></div>
        <div class="o">AI coworker<span>vocabulary, tools, routing</span></div>
        <div class="o">Workflows<span>scheduling, finance, compliance</span></div>
        <div class="o">Mobile manifest<span>capability direction (vision)</span></div>
      </div>
    </div>
  </section>

  ${standardsSection()}

  ${mobileVision({ display: "your business", mobile: false })}

  <section aria-label="Get started">
    <div class="grid">
      <div class="card">
        <h3>Don’t see an exact match?</h3>
        <p style="margin-bottom:12px;">The 56 business types are starting points — the platform adapts further to your specifics during setup, and your AI coworkers keep tailoring as you go. Install and choose the closest fit.</p>
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

// ---- write everything ------------------------------------------------------
let count = 0;
writeFileSync(join(__dirname, "index.html"), hubHTML(), "utf8");
count++;
for (const page of pages) {
  writeFileSync(join(__dirname, `${page.slug}.html`), pageHTML(page), "utf8");
  count++;
}
console.log(`Generated ${count} pages (1 hub + ${pages.length} business types) into ${__dirname}`);

// ---- readability gate: score business-facing copy (the MS-Word metrics) ----
const scored = pages
  .map((p) => ({ slug: p.slug, ...analyze(businessCopy(p)) }))
  .sort((a, b) => b.gradeLevel - a.gradeLevel);
const failing = scored.filter((s) => s.gradeLevel > READING_TARGET);
const mean = (scored.reduce((n, s) => n + s.gradeLevel, 0) / scored.length).toFixed(1);

console.log(`\nReadability of business-facing copy (target ≤ Grade ${READING_TARGET}):`);
for (const s of scored) {
  const flag = s.gradeLevel > READING_TARGET ? "  ✗ OVER" : "  ✓";
  console.log(`  ${s.slug.padEnd(34)} Grade ${String(s.gradeLevel).padStart(4)}  ease ${String(s.readingEase).padStart(4)}  ${band(s.gradeLevel)}${flag}`);
}
console.log(`  mean Grade ${mean} · ${scored.length - failing.length}/${scored.length} within target`);
if (failing.length) {
  console.warn(`\n⚠  ${failing.length} page(s) above the high-school target: ${failing.map((f) => `${f.slug} (${f.gradeLevel})`).join(", ")}`);
}

// Persist a readability report artifact (Jekyll-ignored: starts with "_").
const report =
  `# Readability report — business-facing copy\n\n` +
  `Metric: Flesch–Kincaid (the test Microsoft Word reports). Target: Grade ≤ ${READING_TARGET} ` +
  `(high-school, plain English). Technical sections (standards, archetype-engine) are excluded by design.\n\n` +
  `Mean Grade: **${mean}** · within target: **${scored.length - failing.length}/${scored.length}**\n\n` +
  `| Page | Grade | Reading ease | Words/sentence | Band |\n|---|---|---|---|---|\n` +
  scored
    .map((s) => `| ${s.slug} | ${s.gradeLevel} | ${s.readingEase} | ${s.wordsPerSentence} | ${band(s.gradeLevel)} |`)
    .join("\n") +
  `\n`;
writeFileSync(join(__dirname, "_readability-report.md"), report, "utf8");
console.log("\nWrote _readability-report.md");
