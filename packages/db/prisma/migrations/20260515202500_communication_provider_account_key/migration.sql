UPDATE "CommunicationChannelBinding"
SET "providerAccountId" = ''
WHERE "providerAccountId" IS NULL;

ALTER TABLE "CommunicationChannelBinding"
ALTER COLUMN "providerAccountId" SET DEFAULT '';

ALTER TABLE "CommunicationChannelBinding"
ALTER COLUMN "providerAccountId" SET NOT NULL;

UPDATE "CommunicationChannelSession"
SET "providerAccountId" = ''
WHERE "providerAccountId" IS NULL;

ALTER TABLE "CommunicationChannelSession"
ALTER COLUMN "providerAccountId" SET DEFAULT '';

ALTER TABLE "CommunicationChannelSession"
ALTER COLUMN "providerAccountId" SET NOT NULL;
