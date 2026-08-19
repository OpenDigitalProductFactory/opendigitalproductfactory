import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { redact, type RedactResult } from "./redact";

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(__dirname, `fixtures/${name}`), "utf8")) as T;
}

describe("redact — PII scrubbing", () => {
  it("redacts SSN to last-4 format xxx-xx-####", () => {
    const payload = loadFixture<{ workers: unknown[] }>("worker-response.json");
    const { value } = redact(payload) as RedactResult<{
      workers: Array<{ person: { governmentIDs: Array<{ idValue: string }> } }>;
    }>;
    expect(value.workers[0]!.person.governmentIDs[0]!.idValue).toBe("xxx-xx-6789");
    expect(value.workers[1]!.person.governmentIDs[0]!.idValue).toBe("xxx-xx-4321");
  });

  it("redacts bank account and routing numbers to ****####", () => {
    const payload = loadFixture<{ payStatements: unknown[] }>("pay-statement-response.json");
    const { value } = redact(payload) as RedactResult<{
      payStatements: Array<{
        directDeposits: Array<{
          bankAccountNumber: string;
          routingNumber: string;
          accountNumber?: string;
        }>;
      }>;
    }>;
    const dd = value.payStatements[0]!.directDeposits[0]!;
    expect(dd.bankAccountNumber).toBe("****7890");
    expect(dd.routingNumber).toBe("****0021");
    expect(dd.accountNumber).toBe("****3210");
  });

  it("redacts accountNumber on nested deduction payees", () => {
    const payload = loadFixture<{ deductions: unknown[] }>("deduction-response.json");
    const { value } = redact(payload) as RedactResult<{
      deductions: Array<{ payee?: { accountNumber?: string } }>;
    }>;
    expect(value.deductions[1]!.payee!.accountNumber).toBe("****3221");
  });

  it("truncates dateOfBirth / birthDate to year-only", () => {
    const payload = loadFixture<{ workers: unknown[] }>("worker-response.json");
    const { value } = redact(payload) as RedactResult<{
      workers: Array<{ person: { birthDate: string } }>;
    }>;
    expect(value.workers[0]!.person.birthDate).toBe("1984");
    expect(value.workers[1]!.person.birthDate).toBe("1991");
  });

  it("preserves non-PII structure and primitive values unchanged", () => {
    const payload = loadFixture<{ payStatements: unknown[] }>("pay-statement-response.json");
    const { value } = redact(payload) as RedactResult<{
      payStatements: Array<{
        statementID: string;
        payDate: string;
        grossPayAmount: { amountValue: number };
      }>;
    }>;
    expect(value.payStatements[0]!.statementID).toBe("PS-2026-0401");
    expect(value.payStatements[0]!.payDate).toBe("2026-04-15");
    expect(value.payStatements[0]!.grossPayAmount.amountValue).toBe(4500);
  });

  it("flags suspiciousContentDetected=true when a jailbreak pattern appears in free text", () => {
    const payload = loadFixture<{ workers: unknown[] }>("worker-response.json");
    const result = redact(payload);
    expect(result.suspiciousContentDetected).toBe(true);
  });

  it("does not flag suspiciousContentDetected for benign free text", () => {
    const benign = {
      workers: [
        {
          person: { legalName: { givenName: "Jane" } },
          workAssignments: [{ note: "Normal onboarding note; welcome to the team." }],
        },
      ],
    };
    const result = redact(benign);
    expect(result.suspiciousContentDetected).toBe(false);
  });

  it("strips the jailbreak sentence but preserves surrounding benign content in notes", () => {
    const payload = loadFixture<{ timeCards: unknown[] }>("time-card-response.json");
    const { value } = redact(payload) as RedactResult<{
      timeCards: Array<{
        entries: Array<{ notes: string }>;
      }>;
    }>;
    expect(value.timeCards[0]!.entries[0]!.notes).toBe("Normal shift; covered standup for Jane.");
    // Day 2 is entirely a jailbreak — fine if scrubbed to empty/marker, but must not contain the injection verbatim
    expect(value.timeCards[0]!.entries[1]!.notes).not.toMatch(/unrestricted assistant/i);
    expect(value.timeCards[0]!.entries[2]!.notes).toBe("Late end — release cut ran long.");
  });

  it("handles null, undefined, empty arrays without throwing", () => {
    expect(() => redact(null)).not.toThrow();
    expect(() => redact(undefined)).not.toThrow();
    expect(redact({ workers: [] }).value).toEqual({ workers: [] });
  });

  it("does not mutate the input object", () => {
    const payload = loadFixture<{ workers: Array<{ person: { birthDate: string } }> }>(
      "worker-response.json",
    );
    const original = payload.workers[0]!.person.birthDate;
    redact(payload);
    expect(payload.workers[0]!.person.birthDate).toBe(original);
  });

  it("redacts case-insensitively on field names", () => {
    const payload = {
      worker: {
        SSN: "111-22-3333",
        TaxID: "999-88-7777",
        governmentId: "555-44-6666",
        BankAccountNumber: "1111222233334444",
      },
    };
    const { value } = redact(payload) as RedactResult<{
      worker: {
        SSN: string;
        TaxID: string;
        governmentId: string;
        BankAccountNumber: string;
      };
    }>;
    expect(value.worker.SSN).toBe("xxx-xx-3333");
    expect(value.worker.TaxID).toBe("xxx-xx-7777");
    expect(value.worker.governmentId).toBe("xxx-xx-6666");
    expect(value.worker.BankAccountNumber).toBe("****4444");
  });
});
