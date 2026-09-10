// apps/web/lib/tak/marketing-playbook-types.ts
//
// The archetype marketing playbook CONTRACT, split from the playbook DATA.
// marketing-playbooks.ts is a large table of category strategies; keeping the
// shape it must satisfy in its own module means a reader can see the contract
// without scrolling past every category, and the data file stays inside the
// module-size ceiling as more archetypes are filled in.
//
// Re-exported from marketing-playbooks.ts, so every consumer keeps importing
// these names from there.

export type MarketingPlaybook = {
  primaryGoal: string;
  stakeholders: string;
  campaignTypes: string[];
  contentTone: string;
  keyMetrics: string[];
  ctaLanguage: string[];
  agentSkills: string[];
  /**
   * Archetype-specific places this business's marketing actually goes — the
   * specialist channels a generalist marketer would never name. Optional: a
   * category playbook may have none, and an empty list is an honest answer.
   */
  channelVehicles?: MarketingChannelVehicle[];
  /**
   * What this archetype may not do on a given channel, and WHY.
   *
   * ADVISORY, never blocking. The coworker warns and explains; the operator
   * decides. These are field-learned and crowd-sourced, so some will be wrong
   * or go stale as platforms change their terms — a wrong advisory costs a
   * sentence, a wrong block costs an operator their campaign with no recourse.
   *
   * `rationale` is load-bearing, not decoration: it is the only way an operator
   * (or a reviewer accepting a constraint from another install) can judge
   * whether the rule still holds.
   */
  channelConstraints?: MarketingChannelConstraint[];
  /**
   * The archetype's canonical starting segments — a FIRST REVISION, not a
   * finding about any particular organization.
   *
   * MarketingStrategy bootstraps from BusinessContext, and when that is silent
   * (the common case on a fresh install) targetSegments lands empty. The
   * drafter reads targetSegments, so an empty one means every generated asset is
   * written for nobody — which is why the reference install's marketing coworker
   * ran twice and produced nothing.
   *
   * Choosing an archetype should therefore give a starting point. These are the
   * groups that archetype serves by definition; the operator's own answers
   * (BI-74E9BD73) and the coworker's research replace them with what is true for
   * this organization. Descriptions say plainly that they are archetype
   * defaults, so nobody mistakes a seed for an established fact.
   */
  seedSegments?: MarketingSeedSegment[];
};

export type MarketingSeedSegment = {
  name: string;
  /** What this group wants from an organization of this kind. */
  description: string;
};

export type MarketingChannelVehicle = {
  /** Human name of the channel or destination. */
  channel: string;
  /** What this archetype uses it FOR — not a generic description of the site. */
  purpose: string;
};

export type MarketingChannelConstraint = {
  /** The channel or surface the constraint applies to. */
  channel: string;
  /** What must not be done there, stated plainly. */
  constraint: string;
  /** Why — the basis a human can re-check when platform terms change. */
  rationale: string;
  /** Where the same goal can be pursued instead, when one exists. */
  insteadUse?: string;
};
