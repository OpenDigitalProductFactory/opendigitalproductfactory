import { describe, expect, it } from "vitest";

import { instrumentOperationsReadClient } from "./operations-source-client";

describe("instrumentOperationsReadClient", () => {
  it("counts Prisma-style reads while preserving method receivers and ignoring writes", async () => {
    const reads: string[] = [];
    const db = {
      booking: {
        prefix: "booking",
        async findMany() {
          return [this.prefix];
        },
        async update() {
          return this.prefix;
        },
      },
    };
    const instrumented = instrumentOperationsReadClient(db, (model, method) => {
      reads.push(`${model}.${method}`);
    });

    expect(await instrumented.booking.findMany()).toEqual(["booking"]);
    expect(await instrumented.booking.update()).toBe("booking");
    expect(reads).toEqual(["booking.findMany"]);
  });
});
