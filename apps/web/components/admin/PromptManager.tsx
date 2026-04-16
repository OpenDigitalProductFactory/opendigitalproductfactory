"use client";

import { useState, useCallback } from "react";
import type {
  PromptCatalogGroup,
  PromptTemplateDetail,
} from "@/lib/actions/prompt-admin";
import {
  getPromptTemplate,
  updatePromptContent,
  resetPromptToDefault,
} from "@/lib/actions/prompt-admin";

export function PromptManager({
  initialCatalog,
}: {
  initialCatalog: PromptCatalogGroup[];
}) {
  const [catalog] = useState(initialCatalog);
  // All categories start expanded; clicking a header toggles collapse
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<{
    category: string;
    slug: string;
  } | null>(null);
  const [detail, setDetail] = useState<PromptTemplateDetail | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadPrompt = useCallback(
    async (category: string, slug: string) => {
      setSelected({ category, slug });
      setShowHistory(false);
      const data = await getPromptTemplate(category, slug);
      if (data) {
        setDetail(data);
        setContent(data.content);
        setDirty(false);
      }
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!selected || !detail) return;
    setSaving(true);
    const result = await updatePromptContent(
      selected.category,
      selected.slug,
      content,
    );
    setSaving(false);
    if (result.success) {
      setDirty(false);
      setDetail((d) =>
        d
          ? {
              ...d,
              content,
              isOverridden: true,
              version: d.version + 1,
            }
          : d,
      );
      showToast("Saved successfully");
    } else {
      showToast(result.error ?? "Save failed");
    }
  }, [selected, detail, content, showToast]);

  const handleReset = useCallback(async () => {
    if (!selected) return;
    setResetting(true);
    const result = await resetPromptToDefault(
      selected.category,
      selected.slug,
    );
    setResetting(false);
    if (result.success) {
      await loadPrompt(selected.category, selected.slug);
      showToast("Reset to default");
    } else {
      showToast(result.error ?? "Reset failed");
    }
  }, [selected, loadPrompt, showToast]);

  return (
    <div className="flex gap-4" style={{ minHeight: "calc(100vh - 280px)" }}>
      {/* Sidebar — category tree */}
      <nav
        className="w-[240px] shrink-0 overflow-y-auto rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2"
        aria-label="Prompt categories"
      >
        {catalog.map((group) => {
          const isCollapsed = collapsed[group.category] ?? false;
          return (
            <div key={group.category} className="mb-1">
              <button
                onClick={() =>
                  setCollapsed((prev) => ({
                    ...prev,
                    [group.category]: !prev[group.category],
                  }))
                }
                className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left cursor-pointer hover:bg-[var(--dpf-surface-2)] transition-colors"
                aria-expanded={!isCollapsed}
              >
                <span
                  className="text-[10px] text-[var(--dpf-muted)] transition-transform"
                  style={{
                    display: "inline-block",
                    transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                  }}
                >
                  ▼
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                  {group.label}
                </span>
                <span className="ml-auto text-[10px] text-[var(--dpf-muted)]">
                  {group.prompts.length}
                </span>
              </button>
              {!isCollapsed && (
                <ul className="mb-2">
                  {group.prompts.map((p) => {
                    const isActive =
                      selected?.category === p.category &&
                      selected?.slug === p.slug;
                    return (
                      <li key={p.id}>
                        <button
                          onClick={() => loadPrompt(p.category, p.slug)}
                          className={[
                            "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors cursor-pointer",
                            isActive
                              ? "bg-[var(--dpf-accent)] text-white"
                              : "text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]",
                          ].join(" ")}
                        >
                          <span className="truncate">{p.name}</span>
                          {p.isOverridden && (
                            <span
                              className="ml-auto shrink-0 rounded bg-[var(--dpf-warning)] px-1 text-[10px] font-medium text-[var(--dpf-bg)]"
                              title="Modified from default"
                            >
                              mod
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {/* Main editor area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!detail ? (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--dpf-muted)]">
            Select a prompt from the sidebar to view and edit it.
          </div>
        ) : (
          <>
            {/* Top bar */}
            <div className="mb-3 flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="rounded bg-[var(--dpf-surface-2)] px-2 py-0.5 text-[10px] font-medium uppercase text-[var(--dpf-muted)]">
                  {detail.category}
                </span>
                <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
                  {detail.name}
                </h3>
              </div>
              <span className="text-xs text-[var(--dpf-muted)]">
                v{detail.version}
              </span>
              {detail.isOverridden && (
                <span className="rounded bg-[var(--dpf-warning)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--dpf-bg)]">
                  Modified
                </span>
              )}
              {dirty && (
                <span className="text-xs text-[var(--dpf-warning)]">
                  Unsaved changes
                </span>
              )}
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => setShowHistory((h) => !h)}
                  className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-text)] transition-colors hover:bg-[var(--dpf-surface-2)] cursor-pointer"
                >
                  {showHistory ? "Hide History" : "History"}
                </button>
                {detail.isOverridden && (
                  <button
                    onClick={handleReset}
                    disabled={resetting}
                    className="rounded border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-text)] transition-colors hover:bg-[var(--dpf-surface-2)] disabled:opacity-50 cursor-pointer"
                  >
                    {resetting ? "Resetting..." : "Reset to Default"}
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving || !dirty}
                  className="rounded bg-[var(--dpf-accent)] px-3 py-1 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50 cursor-pointer"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>

            {/* Description */}
            {detail.description && (
              <p className="mb-2 text-xs text-[var(--dpf-muted)]">
                {detail.description}
              </p>
            )}

            {/* Metadata chips */}
            {detail.composesFrom.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                <span className="text-[10px] text-[var(--dpf-muted)]">
                  Includes:
                </span>
                {detail.composesFrom.map((ref) => (
                  <span
                    key={ref}
                    className="rounded bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--dpf-text-secondary)]"
                  >
                    {ref}
                  </span>
                ))}
              </div>
            )}

            {/* Editor */}
            <textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(e.target.value !== detail.content);
              }}
              className="flex-1 resize-none rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-3 font-mono text-xs leading-relaxed text-[var(--dpf-text)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
              spellCheck={false}
            />

            {/* Revision history */}
            {showHistory && detail.revisions.length > 0 && (
              <div className="mt-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
                <h4 className="mb-2 text-xs font-semibold text-[var(--dpf-text)]">
                  Revision History
                </h4>
                <ul className="space-y-1">
                  {detail.revisions.map((rev) => (
                    <li
                      key={rev.id}
                      className="flex items-center gap-2 text-xs text-[var(--dpf-text-secondary)]"
                    >
                      <span className="font-mono text-[var(--dpf-muted)]">
                        v{rev.version}
                      </span>
                      <span>
                        {new Date(rev.createdAt).toLocaleDateString()}
                      </span>
                      {rev.changeReason && (
                        <span className="text-[var(--dpf-muted)]">
                          — {rev.changeReason}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded bg-[var(--dpf-surface-2)] px-4 py-2 text-sm text-[var(--dpf-text)] shadow-dpf-md animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}
