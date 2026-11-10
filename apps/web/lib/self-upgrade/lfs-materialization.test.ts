import { describe, it, expect } from "vitest";
import {
  buildLfsLsFilesCommand,
  buildLfsPullCommand,
  describeUnmaterialized,
  parseLfsLsFiles,
  unmaterializedPaths,
} from "./lfs-materialization";

describe("lfs command builders", () => {
  it("scopes both commands to the workspace and omits the leading git", () => {
    expect(buildLfsPullCommand("/host-dpf/.upgrade-workspace")).toEqual([
      "-C",
      "/host-dpf/.upgrade-workspace",
      "lfs",
      "pull",
    ]);
    expect(buildLfsLsFilesCommand("/ws")).toEqual(["-C", "/ws", "lfs", "ls-files"]);
  });
});

describe("parseLfsLsFiles", () => {
  it("reads the materialization marker for each tracked path", () => {
    const parsed = parseLfsLsFiles(
      [
        "be8951db1c * docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx",
        "a1b2c3d4e5 - docs/Reference/Some Report.pdf",
        "",
      ].join("\n"),
    );
    expect(parsed).toEqual([
      {
        oid: "be8951db1c",
        materialized: true,
        path: "docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx",
      },
      { oid: "a1b2c3d4e5", materialized: false, path: "docs/Reference/Some Report.pdf" },
    ]);
  });

  it("keeps paths containing spaces intact", () => {
    expect(parseLfsLsFiles("aaa * docs/a b c.docx")[0].path).toBe("docs/a b c.docx");
  });

  it("ignores unparseable lines rather than failing the upgrade", () => {
    expect(parseLfsLsFiles("git-lfs/3.5.1 (GitHub; linux amd64)\n\n")).toEqual([]);
  });
});

describe("unmaterializedPaths", () => {
  it("returns only the pointer stubs", () => {
    const tracked = parseLfsLsFiles(["aaa * kept.xlsx", "bbb - stub.pdf", "ccc - other.docx"].join("\n"));
    expect(unmaterializedPaths(tracked)).toEqual(["stub.pdf", "other.docx"]);
  });

  it("is empty when every tracked object is present", () => {
    expect(unmaterializedPaths(parseLfsLsFiles("aaa * kept.xlsx"))).toEqual([]);
  });

  // The regression that broke every upgrade: the workbook Dockerfile COPYs and
  // asserts arrived as a pointer, because the portal container had no git-lfs.
  it("flags the IT4IT workbook when it arrives as a pointer", () => {
    const tracked = parseLfsLsFiles(
      "be8951db1c - docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx",
    );
    expect(unmaterializedPaths(tracked)).toEqual([
      "docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx",
    ]);
  });
});

describe("describeUnmaterialized", () => {
  it("names the paths and both known causes", () => {
    const msg = describeUnmaterialized(["docs/Reference/IT4IT_Functional_Criteria_Taxonomy.xlsx"]);
    expect(msg).toContain("IT4IT_Functional_Criteria_Taxonomy.xlsx");
    expect(msg).toContain("git-lfs");
    expect(msg).toContain("Docker context");
  });

  it("truncates a long list instead of dumping every path into the run reason", () => {
    const msg = describeUnmaterialized(["a", "b", "c", "d", "e", "f", "g"]);
    expect(msg).toContain("(+2 more)");
  });
});
