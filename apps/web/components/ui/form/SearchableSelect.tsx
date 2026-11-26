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
import { useCombobox } from "@/components/shared/Combobox";
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
  const popupId = `${controlId}-popup`;
  const valueLabelId = `${controlId}-value`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeOptionRef = useRef<HTMLLIElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

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
      .map(({ option }) => ({ ...option, id: option.value }));
  }, [maxVisibleOptions, options, preferenceRank, query]);

  const combobox = useCombobox({
    options: visibleOptions,
    open,
    onOpenChange: (nextOpen) => {
      if (nextOpen) setOpen(true);
      else closePicker(true);
    },
    onSelect: (option) => onValueChange(option.value),
  });

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [combobox.activeIndex, visibleOptions[combobox.activeIndex]?.id]);

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

  function closePicker(restoreFocus = false) {
    setOpen(false);
    setQuery("");
    if (restoreFocus) triggerRef.current?.focus();
  }

  function handleControlKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openPicker();
      return;
    }
    if (event.key.length === 1 && event.key !== " " && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      openPicker(event.key);
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    // An empty result list must not turn Enter into a form submission.
    if (!combobox.handleKeyDown(event) && event.key === "Enter") event.preventDefault();
  }

  return (
    <div ref={rootRef} className={cx("relative", className)}>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <div className="relative">
        <button
          ref={triggerRef}
          id={controlId}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={open ? popupId : undefined}
          aria-describedby={selectedLabel ? valueLabelId : undefined}
          onClick={() => openPicker()}
          onKeyDown={handleControlKeyDown}
          className={cx(fieldControlClass, "min-h-[44px] cursor-pointer truncate pr-10 text-start", controlClassName)}
        >
          <span id={valueLabelId} className={selectedLabel ? undefined : "text-[var(--dpf-muted)]"}>
            {selectedLabel || placeholder}
          </span>
        </button>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--dpf-muted)]"
        />
      </div>

      {open ? (
        <div
          id={popupId}
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
              {...combobox.controlProps}
              aria-label={searchLabel}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                combobox.setActiveIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
              onBlur={() => closePicker()}
              className="min-h-[44px] w-full rounded-t-md border-0 bg-[var(--dpf-surface-1)] px-9 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
              placeholder="Search..."
            />
          </div>
          <ul
            id={combobox.listboxId}
            role="listbox"
            className="max-h-72 overflow-auto py-1"
            aria-label={searchLabel}
          >
            {visibleOptions.map((option, index) => {
              const active = index === combobox.activeIndex;
              const selectedOption = option.value === value;
              return (
                <li
                  key={option.value}
                  id={combobox.optionId(index)}
                  ref={active ? activeOptionRef : undefined}
                  role="option"
                  aria-selected={selectedOption}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => combobox.setActiveIndex(index)}
                  onClick={() => combobox.select(option)}
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
            })}
          </ul>
          {visibleOptions.length === 0 ? (
            <div role="status" className="px-3 py-3 text-sm text-[var(--dpf-muted)]">{emptyMessage}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
