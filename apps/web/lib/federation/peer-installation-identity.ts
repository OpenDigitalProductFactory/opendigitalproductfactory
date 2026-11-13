// The installation a federation link authenticates. A link is pinned to the
// first installation identity presented over it; any other identity is refused.
// A leaf module so channel demand, work sync and work claims share one rule
// without importing each other.

export async function bindPeerInstallationIdentity(
  db: { federationLink: { updateMany(args: unknown): Promise<{ count: number }> } },
  linkId: string,
  peerInstallationId: string,
): Promise<{ peerInstallationId: string }> {
  const updated = await db.federationLink.updateMany({
    where: {
      linkId,
      OR: [{ peerInstallationId: null }, { peerInstallationId }],
    },
    data: { peerInstallationId },
  });
  if (updated.count !== 1) {
    throw new Error("Peer installation identity does not match this connection.");
  }
  return { peerInstallationId };
}
