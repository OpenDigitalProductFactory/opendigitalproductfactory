// BI-64795FD0 — read a client's official release notes and docs as passages,
// and name the capability-profile fields a passage talks about. Pure: the
// weekly re-verification fetches the pages and keeps the snapshots.
//
// Matching is by keyword, so it proposes, never decides. A passage that names
// OAuth only says the field deserves a human look; the profile changes only
// through a reviewed PR with a live probe (design §5.5).

import { createHash } from "node:crypto";

const MIN_PASSAGE = 12;
const MAX_PASSAGE = 600;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };

/** Visible text of an HTML, Markdown or plain-text page, one passage per block. */
export function extractPassages(page: string): string[] {
  const text = page
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, "\n")
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|p|div|li|h\d|tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#39|[a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
  const passages: string[] = [];
  for (const raw of text.split(/\n/)) {
    const passage = raw.replace(/\s+/g, " ").trim();
    if (passage.length >= MIN_PASSAGE) passages.push(passage.slice(0, MAX_PASSAGE));
  }
  return passages;
}

/** Short stable identity of a passage, so a snapshot stores hashes, not pages. */
export function passageHash(passage: string): string {
  return createHash("sha256").update(passage.toLowerCase()).digest("hex").slice(0, 16);
}

export type ProfileField =
  | "oauthHttps"
  | "oauthLoopbackHttp"
  | "staticHeaders"
  | "pluginScopes"
  | "hookPlane"
  | "reloadRequired"
  | "skillsLoad";

const LOOPBACK_HINT = /\b(loopback|localhost|127\.0\.0\.1)\b|http:\/\//i;
const FIELD_PATTERNS: Array<[ProfileField, RegExp]> = [
  ["staticHeaders", /\b(static|custom|http)[ -]headers?\b|\bheaders? (field|option|config)/i],
  ["pluginScopes", /\bplugins?\b[^.]{0,60}\bscopes?\b|\bscopes?\b[^.]{0,60}\bplugins?\b/i],
  ["hookPlane", /\bhooks?\b|\b(PreToolUse|PostToolUse|SessionStart|SessionEnd|UserPromptSubmit|PermissionRequest)\b/i],
  ["reloadRequired", /\b(hot[- ]?reload|reload|restart)\b[^.]{0,60}\b(plugins?|skills?|mcp|config|hooks?)\b/i],
  ["skillsLoad", /\bskills?\b/i],
];

/** The profile fields a passage mentions, in a stable order. */
export function fieldsMentioned(passage: string): ProfileField[] {
  const fields = new Set<ProfileField>();
  if (/\boauth\b/i.test(passage)) fields.add(LOOPBACK_HINT.test(passage) ? "oauthLoopbackHttp" : "oauthHttps");
  for (const [field, pattern] of FIELD_PATTERNS) {
    if (pattern.test(passage)) fields.add(field);
  }
  return [...fields].sort();
}
