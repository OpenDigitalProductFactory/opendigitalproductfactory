import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.notification.updateMany({
    where: {
      type: "taskrun.stalled",
      read: false,
    },
    data: {
      read: true,
    },
  });
  console.log(`Marked ${result.count} stale taskrun.stalled notifications as read.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
