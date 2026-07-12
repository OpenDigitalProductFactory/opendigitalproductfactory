// BI-B416B12A (EP-WORK-CONVERGENCE): @mention parsing for work-item comments.
// Threaded comments already exist as WorkItemMessage; the missing collaboration
// primitive is @mention → subscription/notification (the "watch fabric"). This
// is the pure core: extract @handles from a comment body and resolve them
// against a caller-supplied roster to notification targets. Resolution of a
// handle to a real principal is the caller's concern (this stays DB-free and
// unit-testable); wiring the targets into Notification is a follow-up.

/**
 * A handle is `@` followed by a letter/digit and then word chars, dot, hyphen,
 * or underscore (max 64). Must be preceded by start-of-string or a non-word,
 * non-`@` char so emails (`a@b`) and `@@` don't match.
 */
const MENTION_RE = /(?:^|[^\w@])@([a-z0-9][a-z0-9._-]{0,63})/gi;

/**
 * Extract unique @mention handles from a comment body, lowercased, in
 * first-seen order. Pure.
 */
export function parseMentions(body: string): string[] {
  if (!body) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of body.matchAll(MENTION_RE)) {
    const handle = match[1]?.toLowerCase();
    if (handle && !seen.has(handle)) {
      seen.add(handle);
      out.push(handle);
    }
  }
  return out;
}

export interface MentionTarget {
  handle: string;
  type: "user" | "agent";
  id: string;
}

export type MentionRoster = Record<string, { type: "user" | "agent"; id: string }>;

/**
 * Resolve the @mentions in a body against a roster (handle → principal) to the
 * set of notification targets. Unknown handles are dropped (a typo'd @name does
 * not notify anyone). Pure — the roster is supplied by the caller. Handles are
 * matched case-insensitively (roster keys are lowercased on read).
 */
export function resolveMentions(body: string, roster: MentionRoster): MentionTarget[] {
  const lowerRoster: MentionRoster = {};
  for (const [key, value] of Object.entries(roster)) {
    lowerRoster[key.toLowerCase()] = value;
  }
  const targets: MentionTarget[] = [];
  for (const handle of parseMentions(body)) {
    const principal = lowerRoster[handle];
    if (principal) {
      targets.push({ handle, type: principal.type, id: principal.id });
    }
  }
  return targets;
}
