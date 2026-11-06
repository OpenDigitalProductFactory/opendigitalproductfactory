"use client";
// BI-2F7BE778: the wiki body textarea with `[[` link autocomplete (spec
// 2026-10-14 knowledge-linking §7, AC-KLE-1).
//
// The textarea is the combobox control (shared Combobox, §3.5). Typing `[[`
// and two characters asks GET /api/wiki/link-suggest for up to 8 pages the
// author can read in the right scope direction; the listbox opens at the
// caret. Arrow keys move, Enter or Tab inserts `[[slug|title]]`, Escape closes
// and keeps the text. With the list closed, every key behaves as in a plain
// textarea.

import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";

import { ComboboxListbox, useCombobox, type ComboboxOption } from "@/components/shared/Combobox";
import { cx, fieldControlClass } from "@/components/ui/form/styles";
import { useT } from "@/lib/i18n/use-t";
import { LINK_QUERY_MIN_LENGTH, findOpenLinkQuery, insertWikiLink, type OpenLinkQuery } from "@/lib/wiki/link-autocomplete";
import type { LinkSuggestion } from "@/lib/wiki/link-suggest";

import { textareaCaretPoint, type CaretPoint } from "./textarea-caret";

const FETCH_DEBOUNCE_MS = 120;

type SuggestionOption = ComboboxOption & { suggestion: LinkSuggestion };

export type WikiBodyFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Slug of the page being edited; sets the link direction on the server. */
  fromSlug: string;
  describedBy?: string;
  rows?: number;
};

export function WikiBodyField({ id, value, onChange, fromSlug, describedBy, rows = 28 }: WikiBodyFieldProps) {
  const t = useT("wiki");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [token, setToken] = useState<(OpenLinkQuery & { end: number }) | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<SuggestionOption[]>([]);
  const [caret, setCaret] = useState<CaretPoint | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const requestSeq = useRef(0);

  const scopeLabel = (scope: LinkSuggestion["scope"]) =>
    scope === "organization"
      ? t("backlinks.scopes.organization")
      : scope === "platform"
        ? t("backlinks.scopes.platform")
        : t("backlinks.scopes.profession");

  // Fetch suggestions for the open token, debounced; a stale reply is ignored.
  const query = token && token.query.length >= LINK_QUERY_MIN_LENGTH ? token.query : null;
  useEffect(() => {
    if (query === null) return;
    const seq = ++requestSeq.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/wiki/link-suggest?${new URLSearchParams({ q: query, from: fromSlug })}`, { signal: controller.signal })
        .then((res) => (res.ok ? (res.json() as Promise<{ suggestions: LinkSuggestion[] }>) : { suggestions: [] }))
        .then(({ suggestions }) => {
          if (seq !== requestSeq.current) return;
          setOptions(
            suggestions.map((s) => ({ id: s.slug, label: s.title, description: s.slug, badge: scopeLabel(s.scope), suggestion: s })),
          );
        })
        .catch(() => {
          if (seq === requestSeq.current && !controller.signal.aborted) setOptions([]);
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    }, FETCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // scopeLabel reads the catalog, which does not change while the editor is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, fromSlug]);

  // Put the caret after an inserted link once React has written the new value.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea && pendingCaret.current !== null) {
      textarea.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const combobox = useCombobox<SuggestionOption>({
    options,
    open,
    onOpenChange: (next) => {
      setOpen(next && query !== null);
      if (!next) setToken(null);
    },
    onSelect: (option) => {
      if (!token) return;
      const inserted = insertWikiLink(value, { start: token.start, end: token.end }, option.suggestion);
      pendingCaret.current = inserted.caret;
      onChange(inserted.text);
    },
    selectOnTab: true,
  });

  function onTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const textarea = event.target;
    const next = textarea.value;
    const position = textarea.selectionStart ?? next.length;
    onChange(next);
    const found = findOpenLinkQuery(next, position);
    if (!found || found.query.length < LINK_QUERY_MIN_LENGTH) {
      setToken(found ? { ...found, end: position } : null);
      setOpen(false);
      return;
    }
    setToken({ ...found, end: position });
    if (found.query !== token?.query) {
      setLoading(true);
      setOptions([]);
    }
    setCaret(textareaCaretPoint(textarea, found.start));
    setOpen(true);
  }

  // Positioned at the caret; the measurement is physical, so is the offset.
  const popupStyle = caret ? { top: caret.top + caret.lineHeight + 4, left: Math.max(0, caret.left) } : undefined;

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        rows={rows}
        required
        spellCheck
        aria-describedby={describedBy}
        {...combobox.controlProps}
        onChange={onTextChange}
        onKeyDown={(event) => {
          if (open) combobox.handleKeyDown(event);
        }}
        onBlur={() => setOpen(false)}
        className={cx(fieldControlClass, "font-mono")}
      />
      <ComboboxListbox
        combobox={combobox}
        options={options}
        label={t("editor.suggestions.label")}
        emptyMessage={t("editor.suggestions.empty")}
        loading={loading}
        loadingMessage={t("editor.suggestions.loading")}
        className="absolute"
        style={popupStyle}
      />
    </div>
  );
}
