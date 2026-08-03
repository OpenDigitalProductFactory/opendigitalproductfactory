import { prisma } from "@dpf/db";

import {
  ingestWorkRoomChannelEvent,
  type RoomChannelIngressDb,
} from "./room-channel-ingress";

type PrismaRoomChannelIngressInput = Omit<
  Parameters<typeof ingestWorkRoomChannelEvent>[0],
  "db"
>;

const ingressDb = prisma as unknown as RoomChannelIngressDb;

/** Provider-neutral production entry point for an adapter's verified inbound event. */
export function ingestPrismaWorkRoomChannelEvent(input: PrismaRoomChannelIngressInput) {
  return ingestWorkRoomChannelEvent({ ...input, db: ingressDb });
}
