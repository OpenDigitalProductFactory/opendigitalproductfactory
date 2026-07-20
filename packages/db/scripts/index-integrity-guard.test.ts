import { describe, expect, it } from "vitest";

// @ts-expect-error — plain .mjs guard script, no type declarations by design
import { checkCollationStability } from "./index-integrity-guard.mjs";

/**
 * Stub client returning canned rows for the two queries checkCollationStability
 * issues, in order: the pg_database row, then the pg_collation census.
 */
function stubClient(databaseRow: Record<string, unknown>, libcCount: number) {
  const responses = [
    { rows: [databaseRow] },
    { rows: [{ collprovider: "c", count: libcCount }, { collprovider: "i", count: 871 }] },
  ];
  let call = 0;
  return { query: async () => responses[call++] };
}

const kinds = (findings: Array<{ kind: string }>) => findings.map((f) => f.kind);
const severityOf = (findings: Array<{ kind: string; severity: string }>, kind: string) =>
  findings.find((f) => f.kind === kind)?.severity;

describe("checkCollationStability", () => {
  it("flags a cluster labelled with a real locale but carrying no libc locale data", async () => {
    // The musl-initdb fingerprint that caused BI-8CCF7F13: en_US.utf8 label,
    // but only C/POSIX/default actually registered.
    const result = await checkCollationStability(
      stubClient(
        {
          datcollate: "en_US.utf8",
          datctype: "en_US.utf8",
          datcollversion: null,
          actual_version: "2.36",
        },
        3,
      ),
    );

    expect(kinds(result.findings)).toContain("collation-provider-mismatch");
    expect(result.libcCount).toBe(3);
  });

  it("treats the provider mismatch as advisory, not a build failure", async () => {
    // It describes how the cluster was initialised and cannot be cleared by any
    // repair, so failing on it would hold CI red forever once the indexes are
    // healthy — and a permanently-red guard is one nobody reads.
    const result = await checkCollationStability(
      stubClient(
        { datcollate: "en_US.utf8", datctype: "en_US.utf8", datcollversion: null, actual_version: "2.36" },
        3,
      ),
    );

    expect(severityOf(result.findings, "collation-provider-mismatch")).toBe("warn");
    expect(severityOf(result.findings, "collation-version-unrecorded")).toBe("warn");
    expect(result.findings.every((f: { severity: string }) => f.severity === "warn")).toBe(true);
  });

  it("fails on a recorded-vs-actual collation version mismatch", async () => {
    // This one IS a regression: the comparator moved under indexes still built
    // for the old one, which is precisely when a REINDEX is required.
    const result = await checkCollationStability(
      stubClient(
        { datcollate: "en_US.utf8", datctype: "en_US.utf8", datcollversion: "2.31", actual_version: "2.36" },
        812,
      ),
    );

    expect(kinds(result.findings)).toContain("collation-version-drift");
    expect(severityOf(result.findings, "collation-version-drift")).toBe("error");
  });

  it("stays silent on a healthy glibc cluster with a matching recorded version", async () => {
    const result = await checkCollationStability(
      stubClient(
        { datcollate: "en_US.utf8", datctype: "en_US.utf8", datcollversion: "2.36", actual_version: "2.36" },
        812,
      ),
    );

    expect(result.findings).toEqual([]);
  });

  it("does not flag a deliberately C-collated cluster as a provider mismatch", async () => {
    // A cluster genuinely initdb'd with --locale=C has few libc collations by
    // design and is immune to comparator drift — the opposite of a problem.
    const result = await checkCollationStability(
      stubClient(
        { datcollate: "C", datctype: "C", datcollversion: "1.0", actual_version: "1.0" },
        3,
      ),
    );

    expect(kinds(result.findings)).not.toContain("collation-provider-mismatch");
  });
});
