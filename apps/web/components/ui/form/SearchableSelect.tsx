"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cx, fieldControlClass } from "./styles";

export type SearchableSelectOption = {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
  disabled?: boolean;
};

export type SearchableSelectProps = {
  id?: string;
  name?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchLabel?: string;
  ariaLabel?: string;
  disabled?: boolean;
  preferredValues?: readonly string[];
  maxVisibleOptions?: number;
  emptyMessage?: string;
  className?: string;
  controlClassName?: string;
};

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/[_/.-]+/g, " ");
}

function optionHaystack(option: SearchableSelectOption): string {
  return normalize([option.label, option.value, option.description, option.searchText].filter(Boolean).join(" "));
}

export function SearchableSelect({
  id,
  name,
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  searchLabel = "Search choices",
  ariaLabel,
  disabled = false,
  preferredValues = [],
  maxVisibleOptions = 10,
  emptyMessage = "No matches",
  className,
  controlClassName,
}: SearchableSelectProps) {
  const generatedId = useId().replace(/:/g, "");
  const controlId = id ?? `searchable-select-${generatedId}`;
  const listboxId = `${controlId}-listbox`;
  const optionId = (index: number) => `${controlId}-option-${index}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = options.find((option) => option.value === value);
  const selectedLabel = selected?.label ?? "";

  const preferenceRank = useMemo(() => {
    const rank = new Map<string, number>();
    [value, ...preferredValues].filter(Boolean).forEach((preferred, index) => {
      if (!rank.has(preferred)) rank.set(preferred, index);
    });
    return rank;
  }, [preferredValues, value]);

  const visibleOptions = useMemo(() => {
    const tokens = normalize(query).split(/\s+/).filter(Boolean);
    return options
      .map((option, index) => ({ option, index, haystack: optionHaystack(option) }))
      .filter(({ option, haystack }) => {
        if (option.disabled) return false;
        return tokens.every((token) => haystack.includes(token));
      })
      .sort((a, b) => {
        const aRank = preferenceRank.get(a.option.value) ?? Number.MAX_SAFE_INTEGER;
        const bRank = preferenceRank.get(b.option.value) ?? Number.MAX_SAFE_INTEGER;
        return aRank - bRank || a.index - b.index;
      })
      .slice(0, maxVisibleOptions)
      .map(({ option }) => option);
  }, [maxVisibleOptions, options, preferenceRank, query]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(visibleOptions.length > 0 ? 0 : -1);
  }, [open, query, visibleOptions.length]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function openPicker(nextQuery = "") {
    if (disabled) return;
    setQuery(nextQuery);
    setOpen(true);
  }

  function closePicker() {
    setOpen(false);
    setQuery("");
  }

  function selectOption(option: SearchableSelectOption) {
    onValueChange(option.value);
    closePicker();
  }

  function handleControlKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
      return;
    }
    if (event.key === "Escape") {
      closePicker();
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      openPicker(event.key);
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((current) => {
          if (visibleOptions.length === 0) return -1;
          return current + 1 < visibleOptions.length ? current + 1 : 0;
        });
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((current) => {
          if (visibleOptions.length === 0) return -1;
          return current - 1 >= 0 ? current - 1 : visibleOptions.length - 1;
        });
        break;
      case "Enter":
        event.preventDefault();
        if (activeIndex >= 0 && visibleOptions[activeIndex]) {
          selectOption(visibleOptions[activeIndex]);
        }
        break;
      case "Escape":
        event.preventDefault();
        closePicker();
        break;
    }
  }

  return (
    <div ref={rootRef} className={cx("relative", className)}>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <div className="relative">
        <input
          id={controlId}
          type="text"
          role="combobox"
          readOnly
          disabled={disabled}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          value={selectedLabel}
          placeholder={placeholder}
          onClick={() => openPicker()}
          onKeyDown={handleControlKeyDown}
          className={cx(fieldControlClass, "min-h-[44px] cursor-pointer pr-10", controlClassName)}
        />
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--dpf-muted)]"
        />
      </div>

      {open ? (
        <div
          className="absolute z-50 mt-1 w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] shadow-dpf-md"
          role="presentation"
        >
          <div className="relative border-b border-[var(--dpf-border)]">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--dpf-muted)]"
            />
            <input
              ref={searchRef}
              type="text"
              aria-label={searchLabel}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="min-h-[44px] w-full rounded-t-md border-0 bg-[var(--dpf-surface-1)] px-9 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
              placeholder="Search..."
            />
          </div>
          <ul
            id={listboxId}
            role="listbox"
            className="max-h-72 overflow-auto py-1"
            aria-label={searchLabel}
          >
            {visibleOptions.length > 0 ? (
              visibleOptions.map((option, index) => {
                const active = index === activeIndex;
                const selectedOption = option.value === value;
                return (
                  <li
                    key={option.value}
                    id={optionId(index)}
                    role="option"
                    aria-selected={selectedOption}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectOption(option)}
                    className={cx(
                      "flex cursor-pointer items-start gap-2 px-3 py-2 text-sm",
                      active
                        ? "bg-[var(--dpf-accent)] text-[var(--dpf-on-accent,var(--dpf-surface-1))]"
                        : "text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]",
                    )}
                  >
                    <Check
                      aria-hidden="true"
                      className={cx("mt-0.5 size-4 shrink-0", selectedOption ? "opacity-100" : "opacity-0")}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{option.label}</span>
                      {option.description ? (
                        <span className={cx("block truncate text-xs", active ? "opacity-80" : "text-[var(--dpf-muted)]")}>
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })
            ) : (
              <li className="px-3 py-3 text-sm text-[var(--dpf-muted)]">{emptyMessage}</li>
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
