// BI-B416B12A (EP-WORK-CONVERGENCE): pure roster-building + recipient-selection
// for work-item comment @mentions. The @handle parsing/resolution core lives in
// mentions.ts; this module is the (still DB-free) glue that turns real principals
// (Users, Agents) into a MentionRoster and turns resolved targets into the set of
// user ids to notify. Keeping it pure keeps the notification policy unit-testable
// and independent of Prisma/React.

import type { MentionRoster, MentionTarget } from "./mentions";

/**
 * Normalize a display name into a mention handle: lowercase, every run of
 * non-alphanumerics collapses to a single "-", and leading/trailing "-" are
 * trimmed. e.g. "Ada Lovelace (AI)" → "ada-lovelace-ai".
 */
function normalizeNameHandle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build a handle→principal roster from real Users and Agents.
 *
 * - Each user contributes one key: the email local-part (before "@"), lowercased.
 * - Each agent contributes up to three keys: its agentId, its slugId (if any), and
 *   a normalized form of its display name — all lowercased.
 *
 * Keys are added in that order; an earlier non-empty key is never overwritten by a
 * later one (first writer wins). Empty/whitespace handles are skipped. Pure.
 */
export function buildMentionRoster(
  users: { id: string; email: string }[],
  agents: { id: string; agentId: string; slugId: string | null; name: string }[],
): MentionRoster {
  const roster: MentionRoster = {};
  const put = (rawKey: string, value: { type: "user" | "agent"; id: string }): void => {
    const key = rawKey.trim().toLowerCase();
    if (!key) return;
    if (roster[key]) return; // first writer wins — do not overwrite an earlier non-empty key
    roster[key] = value;
  };

  for (const user of users) {
    const local = (user.email ?? "").split("@")[0] ?? "";
    put(local, { type: "user", id: user.id });
  }

  for (const agent of agents) {
    put(agent.agentId ?? "", { type: "agent", id: agent.id });
    if (agent.slugId) put(agent.slugId, { type: "agent", id: agent.id });
    put(normalizeNameHandle(agent.name ?? ""), { type: "agent", id: agent.id });
  }

  return roster;
}

/**
 * Distinct ids of the mention targets that are users, in first-seen order,
 * excluding `opts.excludeUserId` (the commenter — you don't notify yourself) and
 * dropping agent targets (an @agent mention doesn't produce a user notification).
 * Pure.
 */
export function mentionNotifyRecipients(
  targets: MentionTarget[],
  opts?: { excludeUserId?: string },
): string[] {
  const exclude = opts?.excludeUserId;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const target of targets) {
    if (target.type !== "user") continue;
    if (exclude && target.id === exclude) continue;
    if (seen.has(target.id)) continue;
    seen.add(target.id);
    out.push(target.id);
  }
  return out;
}
