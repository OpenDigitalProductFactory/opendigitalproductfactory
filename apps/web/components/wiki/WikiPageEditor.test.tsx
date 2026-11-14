// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { namespaceMessages } from "@dpf/i18n";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";

const mocks = vi.hoisted(() => ({ save: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/lib/actions/wiki-edit", () => ({ saveWikiOverlayEdit: mocks.save }));

import { WikiBodyRenderer } from "./WikiBodyRenderer";
import { WikiPageEditor, type WikiPageEditorProps } from "./WikiPageEditor";

// BI-2F7BE778: the wiki editor's link autocomplete (AC-KLE-1), dangling-link
// warning (AC-KLE-3) and preview (AC-KLE-4).

const SLOW = { timeout: 5000 };

const fetchMock = vi.fn();

function renderEditor(overrides: Partial<WikiPageEditorProps> = {}) {
  const props: WikiPageEditorProps = {
    mode: "update",
    pageId: "wp1",
    initialSlug: "entities/customer-portal",
    initialTitle: "Customer portal",
    initialBody: "",
    initialPageKind: "entity",
    initialStatus: "draft",
    pageKindReadOnly: true,
    knownSlugs: ["entities/budget", "entities/customer-portal"],
    ...overrides,
  };
  return render(
    <MessagesProvider locale="en-US" messages={{ wiki: namespaceMessages("en-US", "wiki") }}>
      <WikiPageEditor {...props} />
    </MessagesProvider>,
  );
}

function bodyField() {
  return screen.getByRole("combobox", { name: /body/i }) as HTMLTextAreaElement;
}

function typeBody(text: string) {
  const field = bodyField();
  field.focus();
  fireEvent.change(field, { target: { value: text, selectionStart: text.length, selectionEnd: text.length } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ ok: true, pageId: "wp1", slug: "entities/customer-portal", status: "draft" });
  fetchMock.mockImplementation(async () =>
    new Response(
      JSON.stringify({
        suggestions: [
          { slug: "entities/budget", title: "Budget", pageKind: "entity", scope: "platform" },
          { slug: "entities/budget-policy", title: "Budget policy", pageKind: "summary", scope: "organization" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WikiPageEditor link autocomplete (AC-KLE-1)", () => {
  it("lists matches after [[ and two characters, and Enter inserts [[slug|title]]", async () => {
    renderEditor();
    typeBody("See [[bu");
    const listbox = await screen.findByRole("listbox", { name: "Pages to link" }, SLOW);
    const options = await within(listbox).findAllByRole("option", {}, SLOW);
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Budget"),
      expect.stringContaining("Budget policy"),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/api/wiki/link-suggest?");
    expect(url).toContain("q=bu");
    expect(url).toContain("from=entities%2Fcustomer-portal");
    expect(bodyField().getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(bodyField(), { key: "Enter" });
    expect(bodyField().value).toBe("See [[entities/budget|Budget]]");
    expect(bodyField().getAttribute("aria-expanded")).toBe("false");
  });

  it("asks for nothing after a single character", async () => {
    renderEditor();
    typeBody("See [[b");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on Escape and keeps the typed text", async () => {
    renderEditor();
    typeBody("[[bud");
    await screen.findByRole("listbox", {}, SLOW);
    fireEvent.keyDown(bodyField(), { key: "Escape" });
    expect(bodyField().getAttribute("aria-expanded")).toBe("false");
    expect(bodyField().value).toBe("[[bud");
  });
});

describe("WikiPageEditor dangling-link warning (AC-KLE-3)", () => {
  it("lists unresolved links with their line numbers as the author types", async () => {
    renderEditor();
    typeBody("Intro\n[[entities/missing]] and [[entities/budget]]");
    const region = await screen.findByRole("region", { name: /links that do not resolve/i }, SLOW);
    expect(region.textContent).toContain("entities/missing");
    expect(region.textContent).toContain("Line 2");
    expect(region.textContent).not.toContain("entities/budget");
  });

  it("shows the wiki_lint message on save and saves only when the author saves again", async () => {
    renderEditor({ initialBody: "[[entities/missing]]" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert", {}, SLOW);
    expect(alert.textContent).toContain("An [[link]] target does not exist (blocks publish).");
    expect(alert.textContent).toContain("entities/missing");
    expect(mocks.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1), SLOW);
  });

  it("saves at once when every link resolves", async () => {
    renderEditor({ initialBody: "[[entities/budget]]" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1), SLOW);
    expect(mocks.push).toHaveBeenCalledWith("/coworker-decisions/entities/customer-portal");
  });
});

describe("WikiPageEditor preview (AC-KLE-4)", () => {
  const body = "Intro with [[entities/budget|the budget]].\n\n## Details\n\n- one\n- two";

  it("renders the preview with WikiBodyRenderer, exactly as the viewer does", async () => {
    renderEditor({ initialBody: body });
    const preview = screen.getByRole("region", { name: "Preview" });
    await waitFor(() => expect(preview.innerHTML).toContain(renderToStaticMarkup(<WikiBodyRenderer body={body} />)), SLOW);
  });

  it("switches between Write and Preview on narrow screens from the keyboard-reachable toggle", () => {
    renderEditor({ initialBody: body });
    const write = screen.getByRole("button", { name: "Write" });
    const previewToggle = screen.getByRole("button", { name: "Preview" });
    expect(write.getAttribute("aria-pressed")).toBe("true");
    expect(previewToggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("region", { name: "Preview" }).className).toContain("hidden");

    fireEvent.click(previewToggle);
    expect(previewToggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: "Preview" }).className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(screen.getByRole("region", { name: "Write" }).className).toMatch(/(^|\s)hidden(\s|$)/);
    // Side by side on wide screens: both panes show from lg up.
    expect(screen.getByRole("region", { name: "Write" }).className).toContain("lg:block");
  });

  it("follows the theme: no hardcoded colors in the rendered editor", () => {
    renderEditor({ initialBody: body });
    expect(document.body.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}\b|text-white|bg-white|gray-\d|red-\d/);
  });
});
