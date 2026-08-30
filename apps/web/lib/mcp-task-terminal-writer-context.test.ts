import { describe, expect, it, vi } from "vitest";
import { createInitiativeReviewTerminalToolPolicy } from "./tak/terminal-tool-policy";
import {
  hydrateTerminalWriterContext,
  type PersistedTerminalReaderExecution,
} from "./mcp-task-terminal-writer-context";

const policy = createInitiativeReviewTerminalToolPolicy(
  "record_initiative_design_review",
  ["record_initiative_design_review", "read_source_at_version"],
  {
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    path: "docs/superpowers/specs/design.md",
    commitSha: "9c761214a76a6f0f13e24cbb7f13e1283430181b",
    providerBlobId: "6b3629f9d31980326d228628e1ffa227ba747e93",
  },
)!;

function reader(
  id: string,
  controls: Record<string, unknown>,
  overrides: Partial<PersistedTerminalReaderExecution> = {},
): PersistedTerminalReaderExecution {
  return {
    id,
    toolName: "read_source_at_version",
    parameters: {
      repositoryFullName: policy.immutableReaderArguments!.repositoryFullName,
      path: policy.immutableReaderArguments!.path,
      version: policy.immutableReaderArguments!.version,
      expectedBlobId: policy.immutableReaderArguments!.expectedBlobId,
      ...controls,
    },
    result: {},
    success: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function page(input: {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  hasMore: boolean;
  cursor: string | null;
}) {
  return {
    repositoryFullName: policy.immutableReaderArguments!.repositoryFullName,
    path: policy.immutableReaderArguments!.path,
    version: policy.immutableReaderArguments!.version,
    blobId: policy.immutableReaderArguments!.expectedBlobId,
    content: input.content,
    startLine: input.startLine,
    endLine: input.endLine,
    totalLines: input.totalLines,
    hasMore: input.hasMore,
    nextCursor: input.cursor,
  };
}

describe("terminal writer context hydration", () => {
  it("keeps the exact seven-row BI-F48 reader history recoverable through one bounded reread", async () => {
    const readPage = vi.fn().mockResolvedValue({
      success: true,
      message: "complete deterministic reread",
      data: page({
        content: "server-verified current source",
        startLine: 1,
        endLine: 1,
        totalLines: 1,
        hasMore: false,
        cursor: null,
      }),
    });
    const executionIds = [
      "cmtd3z0ye00gz01rtjr503slt",
      "cmtd3zymp00hh01rtpf9ukk8z",
      "cmtddabd1018m01p99437ddvx",
      "cmtddabis018o01p93xfmw7iw",
      "cmtdgbjkd007001p257plitl1",
      "cmtdgbjsg007201p2yt66vn3r",
      "cmtdgbk06007401p2veda56my",
    ];

    const result = await hydrateTerminalWriterContext({
      policy,
      executions: executionIds.map((id, index) => reader(
        id,
        index === 0 || index === 2 || index === 4
          ? { startLine: 1, maxLines: 200, maxChars: 3_200 }
          : { cursor: `historical-cursor-${index}`, maxLines: 200, maxChars: 3_200 },
        { createdAt: new Date(index) },
      )),
      readPage,
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        readerExecutionIds: executionIds,
        hydratedPageCount: 1,
        context: expect.stringContaining("server-verified current source"),
      },
    });
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(readPage).toHaveBeenCalledWith(expect.objectContaining({ startLine: 1 }));
  });

  it("rehydrates the exact two-reader fixture into bounded ordered source context", async () => {
    const readPage = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        message: "page one",
        data: page({ content: "first\n", startLine: 1, endLine: 1, totalLines: 2, hasMore: true, cursor: "cursor-2" }),
      })
      .mockResolvedValueOnce({
        success: true,
        message: "page two",
        data: page({ content: "second", startLine: 2, endLine: 2, totalLines: 2, hasMore: false, cursor: null }),
      });

    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [
        reader("cmtd3z0ye00gz01rtjr503slt", { startLine: 1, maxChars: 3_200 }),
        reader("cmtd3zymp00hh01rtpf9ukk8z", { startLine: 1, maxLines: 200 }),
      ],
      readPage,
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        readerExecutionIds: ["cmtd3z0ye00gz01rtjr503slt", "cmtd3zymp00hh01rtpf9ukk8z"],
        hydratedPageCount: 2,
        hydratedCharCount: 12,
        context: expect.stringContaining("first\nsecond"),
      },
    });
    expect(readPage).toHaveBeenNthCalledWith(1, expect.objectContaining({ startLine: 1 }));
    expect(readPage).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: "cursor-2" }));
  });

  it("accepts character-bounded reread pages that continue on the same source line", async () => {
    const readPage = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        message: "character-bounded first page",
        data: page({ content: "first ", startLine: 1, endLine: 1, totalLines: 2, hasMore: true, cursor: "byte-cursor-6" }),
      })
      .mockResolvedValueOnce({
        success: true,
        message: "continuation page",
        data: page({ content: "line\nsecond", startLine: 1, endLine: 2, totalLines: 2, hasMore: false, cursor: null }),
      });

    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [
        reader("cmtd3z0ye00gz01rtjr503slt", { startLine: 1, maxChars: 3_200 }),
        reader("cmtd3zymp00hh01rtpf9ukk8z", { startLine: 1, maxLines: 200 }),
      ],
      readPage,
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        hydratedPageCount: 2,
        hydratedCharCount: 17,
        context: expect.stringContaining("first line\nsecond"),
      },
    });
    expect(readPage).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: "byte-cursor-6" }));
  });

  it("reuses a complete exact-bound persisted page set without rereading", async () => {
    const readPage = vi.fn();
    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [
        reader("persisted-one", { startLine: 1 }, {
          result: {
            data: page({ content: "first\n", startLine: 1, endLine: 1, totalLines: 2, hasMore: true, cursor: "persisted-cursor" }),
          },
        }),
        reader("persisted-two", { cursor: "persisted-cursor" }, {
          createdAt: new Date(Date.now() + 1),
          result: {
            data: page({ content: "second", startLine: 2, endLine: 2, totalLines: 2, hasMore: false, cursor: null }),
          },
        }),
      ],
      readPage,
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        hydratedPageCount: 2,
        context: expect.stringContaining("first\nsecond"),
      },
    });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("selects the latest coherent complete attempt from a longer exact-bound history", async () => {
    const readPage = vi.fn();
    const firstPage = page({ content: "first\n", startLine: 1, endLine: 1, totalLines: 2, hasMore: true, cursor: "cursor-2" });
    const secondPage = page({ content: "second", startLine: 2, endLine: 2, totalLines: 2, hasMore: false, cursor: null });
    const executions = [
      reader("proof-one", { startLine: 1 }, { createdAt: new Date(1) }),
      reader("proof-two", { startLine: 1 }, { createdAt: new Date(2) }),
      reader("attempt-one-page-one", { startLine: 1 }, { createdAt: new Date(3), result: { data: firstPage } }),
      reader("attempt-one-page-two", { cursor: "cursor-2" }, { createdAt: new Date(4), result: { data: secondPage } }),
      reader("proof-three", { startLine: 1 }, { createdAt: new Date(5) }),
      reader("attempt-two-page-one", { startLine: 1 }, { createdAt: new Date(6), result: { data: firstPage } }),
      reader("attempt-two-page-two", { cursor: "cursor-2" }, { createdAt: new Date(7), result: { data: secondPage } }),
    ];

    const result = await hydrateTerminalWriterContext({ policy, executions, readPage });

    expect(result).toMatchObject({
      ok: true,
      data: {
        readerExecutionIds: executions.map((execution) => execution.id),
        hydratedPageCount: 2,
        context: expect.stringContaining("first\nsecond"),
      },
    });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("ignores an earlier failed exact-bound read when a later complete attempt is available", async () => {
    const readPage = vi.fn();
    const pageContent = (startLine: number, lineCount: number, trailingNewline = true) => {
      const content = Array.from(
        { length: lineCount },
        (_, index) => `line ${startLine + index}`,
      ).join("\n");
      return trailingNewline ? `${content}\n` : content;
    };
    const executions = [
      reader("cmtebzo9r00ea01pgcs87buqu", { startLine: 1 }, {
        createdAt: new Date(0),
        result: { data: page({ content: pageContent(1, 57), startLine: 1, endLine: 57, totalLines: 165, hasMore: true, cursor: "cursor-58" }) },
      }),
      reader("cmtec0nbg00i901pgxu9of8o9", { cursor: "cursor-58" }, {
        createdAt: new Date(1),
        result: { data: page({ content: pageContent(58, 39), startLine: 58, endLine: 96, totalLines: 165, hasMore: true, cursor: "cursor-97" }) },
      }),
      reader("cmtec0ygy00ig01pgx1ijwkz5", { cursor: "cursor-97" }, {
        createdAt: new Date(2),
        result: { data: page({ content: pageContent(97, 51), startLine: 97, endLine: 147, totalLines: 165, hasMore: true, cursor: "cursor-148" }) },
      }),
      reader("cmtec1xmm00ir01pguc730reh", { cursor: "cursor-148" }, {
        createdAt: new Date(3),
        result: { data: page({ content: pageContent(148, 17), startLine: 148, endLine: 164, totalLines: 165, hasMore: true, cursor: "cursor-165" }) },
      }),
      reader("cmtec4dvy00jb01pgq92i32xu", { startLine: 28, maxLines: 40, maxChars: 3_200 }, {
        success: false,
        createdAt: new Date(4),
      }),
      reader("cmtec4i8v00jd01pg00thenhq", { cursor: "cursor-165" }, {
        createdAt: new Date(5),
        result: { data: page({ content: pageContent(165, 1, false), startLine: 165, endLine: 165, totalLines: 165, hasMore: false, cursor: null }) },
      }),
    ];

    const result = await hydrateTerminalWriterContext({ policy, executions, readPage });

    expect(result).toMatchObject({
      ok: true,
      data: {
        readerExecutionIds: [
          "cmtebzo9r00ea01pgcs87buqu",
          "cmtec0nbg00i901pgxu9of8o9",
          "cmtec0ygy00ig01pgx1ijwkz5",
          "cmtec1xmm00ir01pguc730reh",
          "cmtec4i8v00jd01pg00thenhq",
        ],
        hydratedPageCount: 5,
        context: expect.stringContaining("line 165"),
      },
    });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("fails closed when two complete persisted attempts disagree about bound source content", async () => {
    const readPage = vi.fn();
    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [
        reader("attempt-one", { startLine: 1 }, {
          createdAt: new Date(1),
          result: { data: page({ content: "first", startLine: 1, endLine: 1, totalLines: 1, hasMore: false, cursor: null }) },
        }),
        reader("attempt-two", { startLine: 1 }, {
          createdAt: new Date(2),
          result: { data: page({ content: "conflict", startLine: 1, endLine: 1, totalLines: 1, hasMore: false, cursor: null }) },
        }),
      ],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "terminal_writer_context_attempts_conflict" });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("keeps the reader ceiling scoped to each persisted attempt", async () => {
    const readPage = vi.fn();
    const executions = Array.from({ length: 7 }, (_, index) => {
      const isFirst = index === 0;
      const isLast = index === 6;
      return reader(`page-${index + 1}`, isFirst ? { startLine: 1 } : { cursor: `cursor-${index}` }, {
        createdAt: new Date(index),
        result: {
          data: page({
            content: isLast ? "last" : "line\n",
            startLine: index + 1,
            endLine: index + 1,
            totalLines: 7,
            hasMore: !isLast,
            cursor: isLast ? null : `cursor-${index + 1}`,
          }),
        },
      });
    });

    const result = await hydrateTerminalWriterContext({ policy, executions, readPage });

    expect(result).toMatchObject({ ok: false, code: "terminal_writer_context_reader_count_invalid" });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("discards an incomplete persisted page set and rereads the whole artifact from line one", async () => {
    const readPage = vi.fn().mockResolvedValue({
      success: true,
      message: "complete deterministic reread",
      data: page({ content: "fresh complete source", startLine: 1, endLine: 1, totalLines: 1, hasMore: false, cursor: null }),
    });
    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [reader("partial", { startLine: 1 }, {
        result: {
          data: page({ content: "partial", startLine: 1, endLine: 1, totalLines: 2, hasMore: true, cursor: "missing-page" }),
        },
      })],
      readPage,
    });

    expect(result).toMatchObject({
      ok: true,
      data: { hydratedPageCount: 1, context: expect.stringContaining("fresh complete source") },
    });
    expect(result.ok && result.data.context).not.toContain("partialfresh");
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(readPage).toHaveBeenCalledWith(expect.objectContaining({ startLine: 1 }));
  });

  it.each([
    {
      name: "gap",
      second: page({ content: "third", startLine: 3, endLine: 3, totalLines: 3, hasMore: false, cursor: null }),
    },
    {
      name: "overlap",
      second: page({ content: "first-again", startLine: 1, endLine: 1, totalLines: 2, hasMore: false, cursor: null }),
    },
    {
      name: "changed total",
      second: page({ content: "second", startLine: 2, endLine: 2, totalLines: 3, hasMore: false, cursor: null }),
    },
  ])("rejects a contentful persisted page set with $name", async ({ second }) => {
    const readPage = vi.fn();
    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [
        reader("persisted-one", { startLine: 1 }, {
          result: {
            data: page({ content: "first\n", startLine: 1, endLine: 1, totalLines: 2, hasMore: true, cursor: "persisted-cursor" }),
          },
        }),
        reader("persisted-two", { cursor: "persisted-cursor" }, {
          createdAt: new Date(Date.now() + 1),
          result: { data: second },
        }),
      ],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "terminal_writer_context_page_sequence_invalid" });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("fails closed before reading when persisted identity conflicts with the binding", async () => {
    const readPage = vi.fn();
    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [reader("conflict", { version: "0".repeat(40) })],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "terminal_reader_identity_conflict" });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("does not treat a lone failed persisted reader as hydration authority", async () => {
    const readPage = vi.fn();
    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [reader("failed", {}, { success: false })],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "terminal_writer_context_reader_count_invalid" });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("rejects a failed reader whose immutable binding conflicts", async () => {
    const readPage = vi.fn();
    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [reader("failed-conflict", { version: "0".repeat(40) }, { success: false })],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "terminal_reader_identity_conflict" });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized failed reader instead of ignoring it as history", async () => {
    const readPage = vi.fn();
    const result = await hydrateTerminalWriterContext({
      policy: { ...policy, readerToolNames: ["read_source_at_version", "search_source_at_version"] },
      executions: [reader("failed-search", {}, {
        toolName: "search_source_at_version",
        success: false,
      })],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "terminal_writer_context_reader_failed" });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("does not let a failed content page bridge a successful pagination gap", async () => {
    const readPage = vi.fn();
    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [
        reader("successful-first", { startLine: 1 }, {
          createdAt: new Date(1),
          result: { data: page({ content: "first\n", startLine: 1, endLine: 1, totalLines: 3, hasMore: true, cursor: "cursor-2" }) },
        }),
        reader("failed-middle", { cursor: "cursor-2" }, {
          success: false,
          createdAt: new Date(2),
          result: { data: page({ content: "second\n", startLine: 2, endLine: 2, totalLines: 3, hasMore: true, cursor: "cursor-3" }) },
        }),
        reader("successful-last", { cursor: "cursor-3" }, {
          createdAt: new Date(3),
          result: { data: page({ content: "third", startLine: 3, endLine: 3, totalLines: 3, hasMore: false, cursor: null }) },
        }),
      ],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "terminal_writer_context_page_sequence_invalid" });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("rejects malformed nonempty content on a failed reader", async () => {
    const readPage = vi.fn();
    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [reader("failed-malformed", { startLine: 1 }, {
        success: false,
        result: { data: { content: "unbound" } },
      })],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "terminal_writer_context_page_invalid" });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("does not treat immutable search metadata as hydrated source content", async () => {
    const readPage = vi.fn();
    const result = await hydrateTerminalWriterContext({
      policy: { ...policy, readerToolNames: ["read_source_at_version", "search_source_at_version"] },
      executions: [reader("search", {}, {
        toolName: "search_source_at_version",
        parameters: {
          query: "same TaskRun",
          version: policy.immutableReaderArguments!.version,
          glob: policy.immutableReaderArguments!.path,
          expectedBlobId: policy.immutableReaderArguments!.expectedBlobId,
        },
      })],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "terminal_writer_context_reader_failed" });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("rejects persisted reader output whose artifact identity is stale", async () => {
    const readPage = vi.fn();
    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [reader("stale", {}, {
        result: {
          success: true,
          data: {
            repositoryFullName: policy.immutableReaderArguments!.repositoryFullName,
            path: policy.immutableReaderArguments!.path,
            version: "0".repeat(40),
            blobId: policy.immutableReaderArguments!.expectedBlobId,
            content: "stale",
          },
        },
      })],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "terminal_writer_context_reader_result_conflict" });
    expect(readPage).not.toHaveBeenCalled();
  });

  it("fails closed when deterministic pagination remains truncated at the bound", async () => {
    const readPage = vi.fn();
    for (let index = 0; index < 6; index += 1) {
      readPage.mockResolvedValueOnce({
        success: true,
        message: `page ${index + 1}`,
        data: page({
          content: "x\n",
          startLine: index + 1,
          endLine: index + 1,
          totalLines: 7,
          hasMore: true,
          cursor: `cursor-${index + 1}`,
        }),
      });
    }

    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [reader("reader", {})],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "terminal_writer_context_truncated" });
    expect(readPage).toHaveBeenCalledTimes(6);
  });

  it("fails closed when deterministic rereading fails", async () => {
    const readPage = vi.fn().mockResolvedValue({
      success: false,
      message: "immutable blob temporarily unavailable",
      error: "read_source_unavailable",
    });

    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [reader("reader", {})],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "read_source_unavailable" });
  });

  it.each([
    {
      name: "gap",
      second: page({ content: "third", startLine: 3, endLine: 3, totalLines: 3, hasMore: false, cursor: null }),
    },
    {
      name: "overlap",
      second: page({ content: "first-again", startLine: 1, endLine: 1, totalLines: 2, hasMore: false, cursor: null }),
    },
    {
      name: "changing totalLines",
      second: page({ content: "second", startLine: 2, endLine: 2, totalLines: 3, hasMore: false, cursor: null }),
    },
  ])("fails closed on $name between hydrated pages", async ({ second }) => {
    const readPage = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        message: "page one",
        data: page({ content: "first\n", startLine: 1, endLine: 1, totalLines: 2, hasMore: true, cursor: "cursor-2" }),
      })
      .mockResolvedValueOnce({ success: true, message: "page two", data: second });

    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [reader("reader", {})],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "terminal_writer_context_page_sequence_invalid" });
  });

  it("fails closed when a pagination cursor repeats", async () => {
    const readPage = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        message: "page one",
        data: page({ content: "first\n", startLine: 1, endLine: 1, totalLines: 3, hasMore: true, cursor: "same" }),
      })
      .mockResolvedValueOnce({
        success: true,
        message: "page two",
        data: page({ content: "second\n", startLine: 2, endLine: 2, totalLines: 3, hasMore: true, cursor: "same" }),
      });

    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [reader("reader", {})],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "terminal_writer_context_cursor_repeated" });
  });

  it("fails closed when one hydrated page exceeds the bounded content budget", async () => {
    const readPage = vi.fn().mockResolvedValue({
      success: true,
      message: "oversize",
      data: page({ content: "x".repeat(3_201), startLine: 1, endLine: 1, totalLines: 1, hasMore: false, cursor: null }),
    });

    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [reader("reader", {})],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "terminal_writer_context_oversize" });
  });
});
