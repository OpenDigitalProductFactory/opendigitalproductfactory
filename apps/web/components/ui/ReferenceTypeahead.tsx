"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
} from "react";
import {
  useFloating,
  useClick,
  useDismiss,
  useInteractions,
  offset,
  flip,
  size,
} from "@floating-ui/react";

type RefItem = { id: string; label: string };

type ReferenceTypeaheadProps = {
  placeholder?: string;
  onSearch: (query: string) => Promise<RefItem[]>;
  onSelect: (item: RefItem) => void;
  onAddNew?: (query: string) => void;
  addNewLabel?: string;
  value: RefItem | null;
  disabled?: boolean;
};

export function ReferenceTypeahead({
  placeholder = "Search...",
  onSearch,
  onSelect,
  onAddNew,
  addNewLabel = "item",
  value,
  disabled = false,
}: ReferenceTypeaheadProps) {
  const [query, setQuery] = useState(value?.label ?? "");
  const [results, setResults] = useState<RefItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Sync display when value prop changes externally
  useEffect(() => {
    setQuery(value?.label ?? "");
  }, [value]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    middleware: [
      offset(4),
      flip(),
      size({
        apply({ rects, elements }) {
          Object.assign(elements.floating.style, {
            width: `${rects.reference.width}px`,
          });
        },
      }),
    ],
  });

  const click = useClick(context, { enabled: false });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
  ]);

  const performSearch = useCallback(
    (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([]);
        setOpen(false);
        return;
      }
      setLoading(true);
      onSearch(searchQuery)
        .then((items) => {
          setResults(items);
          setActiveIndex(-1);
          setOpen(true);
        })
        .catch(() => {
          setResults([]);
        })
        .finally(() => setLoading(false));
    },
    [onSearch],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      performSearch(val);
    }, 300);
  };

  const handleSelectItem = useCallback(
    (item: RefItem) => {
      onSelect(item);
      setQuery(item.label);
      setOpen(false);
      setActiveIndex(-1);
    },
    [onSelect],
  );

  const handleAddNew = useCallback(() => {
    if (onAddNew) {
      onAddNew(query);
      setOpen(false);
      setActiveIndex(-1);
    }
  }, [onAddNew, query]);

  // Determine whether to show the "add new" option
  const hasExactMatch = results.some(
    (r) => r.label.toLowerCase() === query.trim().toLowerCase(),
  );
  const showAddNew =
    onAddNew &&
    query.trim().length > 0 &&
    (results.length === 0 || !hasExactMatch);

  const totalItems = results.length + (showAddNew ? 1 : 0);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && e.key !== "Escape") return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1 < totalItems ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 >= 0 ? prev - 1 : totalItems - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < results.length) {
          handleSelectItem(results[activeIndex]!);
        } else if (activeIndex === results.length && showAddNew) {
          handleAddNew();
        }
        break;
      case "Escape":
        setOpen(false);
        setActiveIndex(-1);
        break;
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex] as HTMLElement;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  return (
    <div className="relative">
      <input
        ref={refs.setReference}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-activedescendant={
          activeIndex >= 0 ? `ref-typeahead-option-${activeIndex}` : undefined
        }
        disabled={disabled}
        value={query}
        placeholder={placeholder}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (query.trim() && results.length > 0) setOpen(true);
        }}
        className="w-full rounded border px-3 py-2 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
        {...getReferenceProps()}
      />
      {open && totalItems > 0 && (
        <ul
          ref={(el) => {
            refs.setFloating(el);
            (listRef as React.MutableRefObject<HTMLUListElement | null>).current =
              el;
          }}
          role="listbox"
          style={floatingStyles}
          className="z-50 max-h-60 overflow-auto rounded border bg-[var(--dpf-surface-1)] border-[var(--dpf-border)] py-1 shadow-lg"
          {...getFloatingProps()}
        >
          {results.map((item, idx) => (
            <li
              key={item.id}
              id={`ref-typeahead-option-${idx}`}
              role="option"
              aria-selected={idx === activeIndex}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelectItem(item)}
              onMouseEnter={() => setActiveIndex(idx)}
              className={`cursor-pointer px-3 py-2 text-sm ${
                idx === activeIndex
                  ? "bg-[var(--dpf-accent)] text-white"
                  : "text-[var(--dpf-foreground)] hover:bg-[var(--dpf-surface-2)]"
              }`}
            >
              {item.label}
            </li>
          ))}
          {showAddNew && (
            <li
              id={`ref-typeahead-option-${results.length}`}
              role="option"
              aria-selected={activeIndex === results.length}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleAddNew}
              onMouseEnter={() => setActiveIndex(results.length)}
              className={`cursor-pointer border-t border-[var(--dpf-border)] px-3 py-2 text-sm ${
                activeIndex === results.length
                  ? "bg-[var(--dpf-accent)] text-white"
                  : "text-[var(--dpf-muted)] hover:bg-[var(--dpf-surface-2)]"
              }`}
            >
              + {addNewLabel}: {'"'}{query}{'"'}
            </li>
          )}
        </ul>
      )}
      {loading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--dpf-muted)] border-t-[var(--dpf-accent)]" />
        </div>
      )}
    </div>
  );
}
