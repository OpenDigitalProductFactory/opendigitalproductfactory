import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("WordPress immutable publication receipts", () => {
  it("allows multiple immutable update receipts for the same bound remote resource", () => {
    const schema = readFileSync(fileURLToPath(new URL("../../../../../packages/db/prisma/schema/marketing.prisma", import.meta.url)), "utf8");
    const model = schema.slice(schema.indexOf("model OutboundPublication"), schema.indexOf("model InboundChannelMessage"));
    expect(model).not.toContain("@@unique([channelId, externalId])");
    expect(model).toContain("@@index([channelId, externalId]");
  });
});
