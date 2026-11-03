/** Resolve the database Principal.id stored by Workroom.leaseHolderPrincipalId. */
export async function resolveQualificationLeasePrincipalId(
  db: { principalAlias: { findUnique(args: {
    where: { aliasType_aliasValue_issuer: { aliasType: string; aliasValue: string; issuer: string } };
    select: { principalId: true };
  }): Promise<{ principalId: string } | null> } },
  agentId: string,
): Promise<string | null> {
  const alias = await db.principalAlias.findUnique({
    where: { aliasType_aliasValue_issuer: { aliasType: "agent", aliasValue: agentId, issuer: "" } },
    select: { principalId: true },
  });
  return alias?.principalId ?? null;
}
