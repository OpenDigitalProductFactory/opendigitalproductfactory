// BI-B416B12A (EP-WORK-CONVERGENCE): assemble the @mention roster (handle →
// principal) from the workspace's coworkers and users, so the comment write path
// can resolve @handles. Pure — the caller supplies the coworker/user lists
// (loadRoster() for coworkers; a users query for humans). Handles are slugified
// from the display name (User has no dedicated @handle field yet — email + name
// only; see the plan doc). First writer wins on a slug collision (deterministic:
// coworkers registered before users), an accepted first-cut limitation until a
// real handle convention lands.

import type { MentionRoster } from "./mentions";

export function mentionHandle(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildMentionRoster(input: {
  coworkers: Array<{ agentId: string; name?: string | null; displayName?: string | null }>;
  users: Array<{ id: string; name?: string | null; email: string }>;
}): MentionRoster {
  const roster: MentionRoster = {};

  for (const coworker of input.coworkers) {
    const handle = mentionHandle(coworker.name || coworker.displayName || coworker.agentId);
    if (handle && !roster[handle]) roster[handle] = { type: "agent", id: coworker.agentId };
  }

  for (const user of input.users) {
    const base = user.name?.trim() || user.email.split("@")[0] || "";
    const handle = mentionHandle(base);
    if (handle && !roster[handle]) roster[handle] = { type: "user", id: user.id };
  }

  return roster;
}
