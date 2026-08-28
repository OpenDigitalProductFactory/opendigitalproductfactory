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

  it("does not treat a failed persisted reader as evidence", async () => {
    const readPage = vi.fn();
    const result = await hydrateTerminalWriterContext({
      policy,
      executions: [reader("failed", {}, { success: false })],
      readPage,
    });

    expect(result).toMatchObject({ ok: false, code: "terminal_writer_context_reader_failed" });
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
