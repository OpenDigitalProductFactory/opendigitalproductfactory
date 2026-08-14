type BacklogLookup = {
  backlogItem: {
    findUnique(args: { where: { itemId: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
};

/** Resolve the public BI-* contract to the internal FK stored by duplicateOfId. */
export async function resolveDuplicateBacklogRowId(db: BacklogLookup, itemId: string): Promise<string | null> {
  const row = await db.backlogItem.findUnique({ where: { itemId }, select: { id: true } });
  return row?.id ?? null;
}
