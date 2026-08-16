import { describe, expect, it } from "vitest";

import { buildNachaFile, type NachaBatchInput } from "./nacha";

const originator: NachaBatchInput["originator"] = {
  companyName: "Infinitum Motors",
  companyId: "1234567890",
  originatingDfiRouting: "091000019",
  immediateDestination: "091000019",
  immediateOrigin: "1234567890",
  immediateDestinationName: "Wells Fargo",
  immediateOriginName: "Infinitum Motors",
};

function file(): string {
  return buildNachaFile({
    originator,
    effectiveDate: new Date(Date.UTC(2026, 8, 15)),
    fileCreated: new Date(Date.UTC(2026, 8, 11, 14, 30)),
    entries: [
      {
        receiverName: "Maria Reyes",
        routingNumber: "021000021", // RDFI8 02100002
        accountNumber: "123456789",
        accountType: "checking",
        amountCents: 250000,
        individualId: "emp-1",
      },
      {
        receiverName: "Jorge Gutierrez",
        routingNumber: "011401533", // RDFI8 01140153
        accountNumber: "987654321",
        accountType: "savings",
        amountCents: 180050,
        individualId: "emp-2",
      },
    ],
  });
}

describe("buildNachaFile", () => {
  const lines = file().split("\r\n").filter((l) => l.length > 0);

  it("emits fixed 94-char records blocked to a multiple of 10", () => {
    expect(lines.every((l) => l.length === 94)).toBe(true);
    expect(lines.length % 10).toBe(0);
  });

  it("has the required record types in order", () => {
    expect(lines[0].startsWith("101")).toBe(true); // file header
    expect(lines[1].startsWith("5220")).toBe(true); // batch header, credits-only
    expect(lines[2][0]).toBe("6"); // entry detail
    expect(lines[3][0]).toBe("6");
    expect(lines[4].startsWith("8220")).toBe(true); // batch control
    expect(lines[5][0]).toBe("9"); // file control
    // remaining are 9-filler padding
    for (let i = 6; i < lines.length; i++) expect(lines[i]).toBe("9".repeat(94));
  });

  it("encodes PPD credit transaction codes (22 checking, 32 savings)", () => {
    expect(lines[2].slice(1, 3)).toBe("22");
    expect(lines[3].slice(1, 3)).toBe("32");
  });

  it("encodes the net amount in cents, right-justified 10 wide", () => {
    expect(lines[2].slice(29, 39)).toBe("0000250000");
    expect(lines[3].slice(29, 39)).toBe("0000180050");
  });

  it("balances: batch + file control carry entry count, hash, and total credits", () => {
    // entry hash = 02100002 + 01140153 = 3240155
    const hash = "0003240155";
    const totalCredits = "000000430050"; // 250000 + 180050, 12 wide
    const batchControl = lines[4];
    expect(batchControl.slice(4, 10)).toBe("000002"); // entry+addenda count
    expect(batchControl.slice(10, 20)).toBe(hash);
    expect(batchControl.slice(20, 32)).toBe("000000000000"); // total debits
    expect(batchControl.slice(32, 44)).toBe(totalCredits);

    const fileControl = lines[5];
    expect(fileControl.slice(1, 7)).toBe("000001"); // batch count
    expect(fileControl.slice(13, 21)).toBe("00000002"); // entry+addenda count (8 wide)
    expect(fileControl.slice(21, 31)).toBe(hash);
    expect(fileControl.slice(43, 55)).toBe(totalCredits);
  });

  it("uses the effective entry date (YYMMDD) in the batch header", () => {
    expect(lines[1]).toContain("260915"); // 2026-09-15
  });

  it("refuses an invalid ABA routing checksum instead of emitting a corrupt artifact", () => {
    const input: NachaBatchInput = {
      originator,
      effectiveDate: new Date(Date.UTC(2026, 8, 15)),
      fileCreated: new Date(Date.UTC(2026, 8, 11, 14, 30)),
      entries: [
        {
          receiverName: "Maria Reyes",
          routingNumber: "021000022",
          accountNumber: "123456789",
          accountType: "checking",
          amountCents: 250000,
          individualId: "emp-1",
        },
      ],
    };

    expect(() => buildNachaFile(input)).toThrow(/routingNumber.*checksum/);
  });

  it("refuses empty account numbers and fractional cent amounts", () => {
    const base: NachaBatchInput = {
      originator,
      effectiveDate: new Date(Date.UTC(2026, 8, 15)),
      fileCreated: new Date(Date.UTC(2026, 8, 11, 14, 30)),
      entries: [
        {
          receiverName: "Maria Reyes",
          routingNumber: "021000021",
          accountNumber: "",
          accountType: "checking",
          amountCents: 250000,
          individualId: "emp-1",
        },
      ],
    };

    expect(() => buildNachaFile(base)).toThrow(/accountNumber/);
    expect(() =>
      buildNachaFile({
        ...base,
        entries: [{ ...base.entries[0], accountNumber: "123456789", amountCents: 1.5 }],
      }),
    ).toThrow(/amountCents/);
  });

  it("refuses an empty payroll batch", () => {
    expect(() =>
      buildNachaFile({
        originator,
        effectiveDate: new Date(Date.UTC(2026, 8, 15)),
        fileCreated: new Date(Date.UTC(2026, 8, 11, 14, 30)),
        entries: [],
      }),
    ).toThrow(/at least one entry/);
  });
});
