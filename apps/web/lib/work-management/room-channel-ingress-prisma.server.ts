import { prisma } from "@dpf/db";

import {
  ingestWorkroomChannelEvent,
  type RoomChannelIngressDb,
} from "./room-channel-ingress";

type PrismaRoomChannelIngressInput = Omit<
  Parameters<typeof ingestWorkroomChannelEvent>[0],
  "db"
>;

const ingressDb = prisma as unknown as RoomChannelIngressDb;

/** Provider-neutral production entry point for an adapter's verified inbound event. */
export function ingestPrismaWorkroomChannelEvent(input: PrismaRoomChannelIngressInput) {
  return ingestWorkroomChannelEvent({ ...input, db: ingressDb });
}
