// The consent screen, rendered by the authorization endpoint itself.
//
// WHY THIS IS NOT A NEXT PAGE ROUTE. It was one, briefly, and the page-purpose
// identity ratchet correctly refused it: every portal page route must carry a
// ratified purpose contract declaring its parent area, entry points, navigation
// layer, discovery cue and expected path. An OAuth consent interstitial has
// none of those. Nobody navigates to it, it belongs to no area, and it is
// never in the nav. Filling that contract in would have been fiction, and
// ratification requires an owner reference that cannot be invented. Rendering
// it from the authorization endpoint is also the ordinary shape for an OAuth
// authorization server.
//
// Self-contained HTML: no app CSS is loaded here, so the styling is inline and
// theme-aware via CSS system colors rather than the portal's token sheet.
//
// Design: docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md §4.6

import { PUBLIC_SCOPE_COPY, type PublicScope } from "@/lib/auth/oauth-scope-map";

/** Escape for HTML text and double-quoted attribute contexts. Every dynamic
 *  value below is attacker-influenced — a DCR client picks its own name, and
 *  redirect/resource come off the query string. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// CSS system colors, not a hand-authored palette.
//
// The platform's --dpf-* colors are hand-authored in app/globals.css (the token
// source says so explicitly: "color VALUES are deliberately not here"), and this
// page is served from an API route with no app stylesheet, so those custom
// properties are simply not in scope here. Rather than duplicate hex values
// that would immediately drift from the real palette, this uses the CSS system
// color keywords with `color-scheme: light dark`: the browser supplies the
// user's actual light/dark colors, so the screen is theme-aware by
// construction and contrasts correctly on every platform.
//
// It also suits what this surface IS — a short-lived trust prompt that should
// read as a browser-native dialog rather than a half-branded portal page it
// cannot fully imitate.
const STYLE = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;background:Canvas;color:CanvasText;font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;justify-content:center;padding:24px}
main{width:100%;max-width:560px;background:Canvas;border:1px solid GrayText;border-radius:10px;padding:28px}
h1{font-size:20px;margin:.2em 0 .4em}
.eyebrow{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:GrayText;margin:0}
p{color:GrayText;margin:.5em 0}
.warn{border:1px solid Mark;background:Mark;color:MarkText;border-radius:6px;padding:10px 12px;font-size:13px}
fieldset{border:0;padding:0;margin:22px 0 0}
legend{font-weight:600;color:CanvasText;padding:0;margin-bottom:10px}
label.scope{display:flex;gap:10px;align-items:flex-start;padding:8px 0;cursor:pointer}
label.scope input{margin-top:3px}
.scope-title{display:block;font-weight:600;font-size:14px;color:CanvasText}
.scope-detail{display:block;font-size:13px;color:GrayText}
dl{border-top:1px solid GrayText;margin:20px 0 0;padding-top:14px;font-size:12px;color:GrayText}
dl div{display:flex;gap:8px;margin:3px 0}
dt{font-weight:600;flex:0 0 92px}
dd{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.actions{display:flex;gap:10px;margin-top:22px}
button{flex:1;padding:10px 16px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer}
select{width:100%;padding:10px;border:1px solid GrayText;border-radius:6px;background:Field;color:FieldText;font:inherit}
button.primary{background:Highlight;color:HighlightText;border:1px solid Highlight}
button.secondary{background:ButtonFace;color:ButtonText;border:1px solid GrayText}
.foot{font-size:12px;margin-top:18px}
.consequence{color:CanvasText;margin:14px 0 0}
details{margin:6px 0 0}
summary{cursor:pointer;color:GrayText;font-size:13px}
details[open] summary{margin-bottom:8px}
ul.perms{margin:8px 0 0;padding-left:20px;color:CanvasText}
ul.perms li{margin:4px 0}
.choice{margin:4px 0 0;font-size:13px}
`.trim();

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main></body></html>`;
}

export function renderConsentRefusal(title: string, detail: string): string {
  return shell(
    title,
    `<h1>${esc(title)}</h1><p>${esc(detail)}</p>
<p class="foot">Nothing was connected and no permission was granted. You can close this page.</p>`,
  );
}

export type ConsentView = {
  clientName: string;
  selfAsserted: boolean;
  installationName: string;
  actingUser: string;
  scopes: readonly PublicScope[];
  resource: string;
  redirectUri: string;
  /** Echoed back verbatim so the POST re-validates the same request. */
  hiddenParams: Array<[string, string]>;
  nextAssistantsUrl?: string;
  /** The server's answer to "which assistant does this connection act as". */
  assistant: ConsentAssistant;
  /** Set when the POST re-derived a different answer than the GET showed. */
  driftNotice?: boolean;
  /** Set when the person pressed Connect without choosing between assistants that differ in authority. */
  choiceNotice?: boolean;
};

export type ConsentAssistant = {
  kind: "single" | "resolved" | "choice";
  selected: { agentId: string; displayName: string };
  candidates: Array<{ agentId: string; displayName: string; detail?: string }>;
};

export function renderConsentPage(view: ConsentView): string {
  const scopeRows = view.scopes
    .map(
      (s) => `<label class="scope">
<input type="checkbox" name="granted_scope" value="${esc(s)}" checked>
<span><span class="scope-title">${esc(PUBLIC_SCOPE_COPY[s].title)}</span>
<span class="scope-detail">${esc(PUBLIC_SCOPE_COPY[s].detail)}</span></span></label>`,
    )
    .join("");

  const hidden = view.hiddenParams
    .filter(([key]) => key !== "acting_coworker" && key !== "default_coworker")
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");

  // A DCR client chose its own display name. Saying so is the whole mitigation
  // for the phishing surface dynamic registration opens.
  const selfAssertedNote = view.selfAsserted
    ? `<p class="warn">This client registered itself and chose its own name. Approve it only if you started this connection.</p>`
    : "";

  const assistantBlock = renderAssistant(view);
  const permissionList = view.scopes
    .map((s) => `<li><strong>${esc(PUBLIC_SCOPE_COPY[s].title)}</strong> — ${esc(PUBLIC_SCOPE_COPY[s].detail)}</li>`)
    .join("");
  const driftNotice = view.driftNotice
    ? `<p class="warn">What this connection is allowed to act as changed while this page was open. Nothing was connected. Check the details below and connect again.</p>`
    : view.choiceNotice
      ? `<p class="warn">Choose which assistant this connection works as. Nothing was connected.</p>`
      : "";

  return shell(
    `Connect ${view.clientName}`,
    `<p class="eyebrow">Connect an AI client</p>
<h1>${esc(view.clientName)} wants to work in ${esc(view.installationName)}</h1>
<p>Signed in as ${esc(view.actingUser)}. This client can never do more than your own role allows.</p>
${selfAssertedNote}
${driftNotice}
<form method="post" action="/api/oauth/authorize">
<button type="submit" disabled hidden aria-hidden="true" tabindex="-1"></button>
${hidden}
${assistantBlock}
<fieldset><legend>It will be able to:</legend>
<ul class="perms">${permissionList}</ul>
<details><summary>Adjust permissions</summary>
${scopeRows}
<p class="scope-detail">Unticking a permission grants less. You cannot grant more than was asked for.</p>
</details>
</fieldset>
<dl>
<div><dt>Connecting to</dt><dd>${esc(view.resource)}</dd></div>
<div><dt>Returns to</dt><dd>${esc(view.redirectUri)}</dd></div>
</dl>
<div class="actions">
<button class="primary" type="submit" name="decision" value="approve">Connect ${esc(truncate(view.clientName, 40))}</button>
<button class="secondary" type="submit" name="decision" value="deny" formnovalidate>Cancel</button>
</div>
</form>
<p class="foot">You can revoke this at any time in Admin &rsaquo; Platform Development &rsaquo; MCP.</p>`,
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * The assistant line. One sentence states the consequence; the picker only
 * exists behind a disclosure, and it is open only when the candidates differ
 * in authority — a decision the human genuinely has to make.
 */
function renderAssistant(view: ConsentView): string {
  const { assistant } = view;
  const selected = assistant.selected;
  const consequence = `<p class="consequence">It will work as <strong>${esc(selected.displayName)}</strong> under your account.</p>`;

  if (assistant.kind === "choice") {
    // Candidates differ in what they can do, so the person picks one; nothing
    // is pre-selected and the server refuses a Connect without a pick.
    const options = assistant.candidates.map((c) =>
      `<option value="${esc(c.agentId)}">${esc(c.displayName)}${c.detail ? ` — ${esc(c.detail)}` : ""}</option>`,
    ).join("");
    return `<p class="consequence">Choose which assistant it will work as under your account.</p>
<p class="choice">The assistants you may authorize differ in what they can do. They are listed with the least authority first; nothing is chosen for you.</p>
<select name="acting_coworker" aria-label="Assistant role" required><option value="" selected disabled>Choose an assistant…</option>${options}</select>
${view.nextAssistantsUrl ? `<p><a href="${esc(view.nextAssistantsUrl)}">More approved assistants</a></p>` : ""}`;
  }

  if (assistant.kind === "single") {
    return `${consequence}<input type="hidden" name="acting_coworker" value="${esc(selected.agentId)}">
<p class="scope-detail">This assigns a role to this connection. It does not verify the app's name or grant access to a workroom.</p>`;
  }

  const options = assistant.candidates.map((c) =>
    `<option value="${esc(c.agentId)}"${c.agentId === selected.agentId ? " selected" : ""}>${esc(c.displayName)}${c.detail ? ` — ${esc(c.detail)}` : ""}</option>`,
  ).join("");
  const note = `<p class="scope-detail">This assigns a role to this connection. It does not verify the app's name or grant access to a workroom.</p>`;
  return `${followingConsequence(assistant)}
<input type="hidden" name="default_coworker" value="${esc(selected.agentId)}">
<details><summary>Change</summary>
${note}
<select name="acting_coworker" aria-label="Assistant role">${options}</select>
${view.nextAssistantsUrl ? `<p><a href="${esc(view.nextAssistantsUrl)}">More approved assistants</a></p>` : ""}
</details>`;
}

/**
 * The consequence line for a resolved default, kept truthful when the person
 * picks a different assistant under Change. The page carries no script, so
 * the line holds one name per candidate and CSS shows the one whose option is
 * selected; without `:has()` support the default name stays, as before.
 * Agent ids are server-owned; any id that is not a plain token is left out of
 * the stylesheet rather than escaped into a selector.
 */
function followingConsequence(assistant: ConsentAssistant): string {
  const safe = assistant.candidates.filter((c) => /^[A-Za-z0-9_-]+$/.test(c.agentId));
  const names = safe.map((c) =>
    `<strong class="who${c.agentId === assistant.selected.agentId ? " default" : ""}" data-agent="${c.agentId}">${esc(c.displayName)}</strong>`,
  ).join("");
  const rules = [
    `.who{display:none}.who.default{display:inline}`,
    `form:has(select[name="acting_coworker"] option:checked:not([value="${assistant.selected.agentId}"])) .who.default{display:none}`,
    ...safe.map((c) => `form:has(select[name="acting_coworker"] option[value="${c.agentId}"]:checked) .who[data-agent="${c.agentId}"]{display:inline}`),
  ].join("");
  if (!safe.some((c) => c.agentId === assistant.selected.agentId)) {
    return `<p class="consequence">It will work as <strong>${esc(assistant.selected.displayName)}</strong> under your account.</p>`;
  }
  return `<style>${rules}</style><p class="consequence">It will work as ${names} under your account.</p>`;
}

export function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // A consent screen must never be cached or framed.
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
    },
  });
}
