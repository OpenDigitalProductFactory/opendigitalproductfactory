/**
 * Who is accountable for an initiative gate receipt.
 *
 * BI-72F368BC. Both receipt writers resolved the reviewer principal from the
 * HUMAN alias alone (`aliasType: "user"`, the authenticated MCP user), and
 * ignored the agent identity the call already carried. That contradicted the
 * platform's canonical actor resolution — `resolveGaidActorEnvelope` in
 * `@/lib/tak/gaid-actor-envelope` reads the AGENT's principal whenever a call
 * carries an agent id, and the human's only otherwise — and it had a hard
 * consequence: on an install with one human principal, every reviewer
 * resolved to the artifact's own author, so the spec-approval gate could
 * never pass, so no `initiative_scope_baseline` could ever be written, so no
 * schema-v2 plan-coverage receipt was reachable from ANY surface.
 *
 * The independence rule is not relaxed here and must not be: an author still
 * cannot approve their own artifact, and there is no disposition, flag, or
 * environment variable that lets them. What changes is only WHO the reviewer
 * is recorded as. An in-platform reviewer coworker has its own Principal
 * (kind=agent) and its own `initiative_design_review` grant; attributing its
 * review to the delegating human both erased the accountable identity and
 * made the designed independent reviewer structurally unusable.
 *
 * Precedence is deliberately identical to the canonical envelope so there is
 * one answer to "who acted", not two.
 */

export type ReviewerIdentityKind = "coworker" | "human";

export type ReviewerIdentity = {
  principalId: string;
  /** Which identity the principal came from — recorded on the receipt. */
  kind: ReviewerIdentityKind;
};

export type AliasReader = {
  principalAlias: {
    findMany: (args: {
      where: { aliasType: string; aliasValue: string; issuer: string };
      select: { principal: { select: { principalId: true } } };
      take: number;
    }) => Promise<Array<{ principal: { principalId: string } }>>;
  };
};

/** Exactly one alias is an identity; zero or many is ambiguity, never a guess. */
async function soleAliasPrincipal(
  db: AliasReader,
  aliasType: "agent" | "user",
  aliasValue: string,
): Promise<string | null> {
  const aliases = await db.principalAlias.findMany({
    where: { aliasType, aliasValue, issuer: "" },
    select: { principal: { select: { principalId: true } } },
    take: 2,
  });
  return aliases.length === 1 ? aliases[0]?.principal.principalId ?? null : null;
}

/**
 * Resolve the principal accountable for this review.
 *
 * A call carrying an agent id whose coworker has a Principal is attributed to
 * that coworker. Everything else — a direct human call, or an agent id with no
 * registered principal such as an external CLI session label — is attributed
 * to the authenticated human, exactly as before.
 */
export async function resolveReviewerIdentity(
  db: AliasReader,
  args: { reviewerUserId: string; reviewerAgentId: string | null },
): Promise<ReviewerIdentity | null> {
  if (args.reviewerAgentId) {
    const coworker = await soleAliasPrincipal(db, "agent", args.reviewerAgentId);
    if (coworker) return { principalId: coworker, kind: "coworker" };
  }
  const human = await soleAliasPrincipal(db, "user", args.reviewerUserId);
  return human ? { principalId: human, kind: "human" } : null;
}

/**
 * The remediation an author sees when they are the only principal in the room.
 *
 * "An artifact author cannot review their own artifact" named the rule and
 * nothing else: not who the author was, not who the reviewer was, and not the
 * one route that exists. Three sessions have paid for that omission.
 */
export function independentReviewerRemedy(args: {
  gate: string;
  grant: string;
  authorPrincipalId: string;
  reviewerPrincipalId: string;
  reviewerKind: ReviewerIdentityKind;
}): string {
  const sameIdentity = args.authorPrincipalId === args.reviewerPrincipalId;
  return (
    `An artifact author cannot review their own artifact, and the ${args.gate} lane requires an independent reviewer. `
    + `Author principal ${args.authorPrincipalId}; reviewer principal ${args.reviewerPrincipalId} (${args.reviewerKind})`
    + `${sameIdentity ? " — the same identity" : ""}. `
    + `Record this gate as an in-platform reviewer coworker holding the \`${args.grant}\` grant: summon that coworker and have it call the tool, `
    + "so the review is attributed to the coworker's own principal rather than to the delegating human. "
    + "On an install with one human principal that coworker is the ONLY independent reviewer available; "
    + "there is deliberately no self-approval override."
  );
}
