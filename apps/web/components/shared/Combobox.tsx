"use client";
// apps/web/components/shared/Combobox.tsx
//
// The shared combobox (spec 2026-10-14 knowledge-linking §3.5, BI-2F7BE778),
// built to the WAI-ARIA Authoring Practices 1.2 combobox pattern with a listbox
// popup and list autocomplete. No dependency: the wiki editor drives it from
// its body textarea, and the quick switcher (BI-359C7C2F) from an input.
//
// Three layers, so any control can own it:
//   - useCombobox: open/active state, the ARIA attributes for the controlling
//     element, and its keyboard handling.
//   - ComboboxListbox: the popup listbox, with loading and empty states.
//   - Combobox: an input-driven combobox composed from the two.
//
// Keys (APG): ArrowDown/ArrowUp move and wrap; Enter (and Tab when
// `selectOnTab`) selects the active option; Escape and Alt+ArrowUp close;
// Alt+ArrowDown opens. Home/End stay with the text control (caret movement),
// as the APG allows for an editable combobox. Pointer selection keeps focus in
// the control. Colors are --dpf-* tokens only (AGENTS.md §9).

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { cx, fieldControlClass, fieldLabelClass } from "@/components/ui/form/styles";

export type ComboboxOption = {
  /** Stable id, unique within the list. */
  id: string;
  /** The option's accessible name. */
  label: string;
  /** Secondary line, e.g. a slug. */
  description?: string;
  /** A short tag shown at the end, e.g. a scope. */
  badge?: string;
};

export type UseComboboxInput<T extends ComboboxOption> = {
  options: readonly T[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (option: T) => void;
  /** Tab also selects the active option (as the wiki editor wants). */
  selectOnTab?: boolean;
};

export type ComboboxControlProps = {
  role: "combobox";
  "aria-expanded": boolean;
  "aria-controls": string;
  "aria-autocomplete": "list";
  "aria-haspopup": "listbox";
  "aria-activedescendant"?: string;
};

export type ComboboxState<T extends ComboboxOption> = {
  listboxId: string;
  open: boolean;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  optionId: (index: number) => string;
  select: (option: T) => void;
  /** Spread onto the controlling input or textarea. */
  controlProps: ComboboxControlProps;
  /** Call from the control's onKeyDown; returns true when the key was handled (default prevented). */
  handleKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
};

export function useCombobox<T extends ComboboxOption>({
  options,
  open,
  onOpenChange,
  onSelect,
  selectOnTab = false,
}: UseComboboxInput<T>): ComboboxState<T> {
  const baseId = useId().replace(/:/g, "");
  const listboxId = `combobox-${baseId}-listbox`;
  const [activeIndex, setActiveIndex] = useState(0);
  const optionKey = options.map((option) => option.id).join("\u0000");

  // A new list, or a fresh open, starts on the first option (list autocomplete
  // with automatic selection), so Enter takes the best match.
  useEffect(() => {
    setActiveIndex(0);
  }, [optionKey, open]);

  const count = options.length;
  const active = open && count > 0 ? Math.min(activeIndex, count - 1) : -1;
  const optionId = useCallback((index: number) => `${listboxId}-option-${index}`, [listboxId]);

  const select = useCallback(
    (option: T) => {
      onSelect(option);
      onOpenChange(false);
    },
    [onOpenChange, onSelect],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): boolean => {
    let handled = true;
    switch (event.key) {
      case "ArrowDown":
        if (event.altKey || !open) onOpenChange(true);
        else if (count > 0) setActiveIndex((active + 1) % count);
        break;
      case "ArrowUp":
        if (event.altKey) onOpenChange(false);
        else if (open && count > 0) setActiveIndex((active - 1 + count) % count);
        else handled = false;
        break;
      case "Enter":
        if (active >= 0) select(options[active]!);
        else handled = false;
        break;
      case "Tab":
        if (selectOnTab && active >= 0) select(options[active]!);
        else handled = false;
        break;
      case "Escape":
        if (open) onOpenChange(false);
        else handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
    return handled;
  };

  const controlProps: ComboboxControlProps = {
    role: "combobox",
    "aria-expanded": open,
    "aria-controls": listboxId,
    "aria-autocomplete": "list",
    "aria-haspopup": "listbox",
    ...(active >= 0 ? { "aria-activedescendant": optionId(active) } : {}),
  };

  return { listboxId, open, activeIndex: active, setActiveIndex, optionId, select, controlProps, handleKeyDown };
}

export type ComboboxListboxProps<T extends ComboboxOption> = {
  combobox: ComboboxState<T>;
  options: readonly T[];
  /** Accessible name of the listbox. */
  label: string;
  emptyMessage: string;
  loading?: boolean;
  loadingMessage?: string;
  className?: string;
  style?: CSSProperties;
  renderOption?: (option: T, active: boolean) => ReactNode;
};

export function ComboboxListbox<T extends ComboboxOption>({
  combobox,
  options,
  label,
  emptyMessage,
  loading = false,
  loadingMessage,
  className,
  style,
  renderOption,
}: ComboboxListboxProps<T>) {
  const activeRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [combobox.activeIndex]);

  if (!combobox.open) return null;
  const status = loading ? (loadingMessage ?? null) : options.length === 0 ? emptyMessage : null;

  return (
    <div
      className={cx(
        "z-20 min-w-64 max-w-md overflow-hidden rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] shadow-lg",
        className,
      )}
      style={style}
    >
      <ul id={combobox.listboxId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto py-1">
        {options.map((option, index) => {
          const active = index === combobox.activeIndex;
          return (
            <li
              key={option.id}
              id={combobox.optionId(index)}
              ref={active ? activeRef : undefined}
              role="option"
              aria-selected={active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => {
                if (!active) combobox.setActiveIndex(index);
              }}
              onClick={() => combobox.select(option)}
              className={cx(
                "flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm text-[var(--dpf-text)]",
                active && "bg-[var(--dpf-accent-soft)]",
              )}
            >
              {renderOption ? renderOption(option, active) : <DefaultOption option={option} />}
            </li>
          );
        })}
      </ul>
      {status ? (
        <div role="status" className="px-3 py-2 text-xs text-[var(--dpf-muted)]">
          {status}
        </div>
      ) : null}
    </div>
  );
}

function DefaultOption({ option }: { option: ComboboxOption }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{option.label}</span>
        {option.description ? (
          <span className="block truncate font-mono text-xs text-[var(--dpf-muted)]">{option.description}</span>
        ) : null}
      </span>
      {option.badge ? (
        <span className="shrink-0 rounded border border-[var(--dpf-border)] px-1.5 py-0.5 text-xs text-[var(--dpf-muted)]">
          {option.badge}
        </span>
      ) : null}
    </>
  );
}

export type ComboboxProps<T extends ComboboxOption> = {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly T[];
  onSelect: (option: T) => void;
  emptyMessage: string;
  loading?: boolean;
  loadingMessage?: string;
  placeholder?: string;
  selectOnTab?: boolean;
  inputId?: string;
  autoFocus?: boolean;
  className?: string;
};

/** An input-driven combobox: the list opens as the person types. */
export function Combobox<T extends ComboboxOption>({
  label,
  value,
  onValueChange,
  options,
  onSelect,
  emptyMessage,
  loading,
  loadingMessage,
  placeholder,
  selectOnTab,
  inputId,
  autoFocus,
  className,
}: ComboboxProps<T>) {
  const generatedId = useId();
  const id = inputId ?? `combobox-input-${generatedId.replace(/:/g, "")}`;
  const [open, setOpen] = useState(false);
  const combobox = useCombobox({ options, open, onOpenChange: setOpen, onSelect, selectOnTab });

  return (
    <div className={cx("relative space-y-1", className)}>
      <label htmlFor={id} className={cx("block", fieldLabelClass)}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        {...combobox.controlProps}
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(event.target.value.length > 0);
        }}
        onKeyDown={(event) => combobox.handleKeyDown(event)}
        onBlur={() => setOpen(false)}
        className={fieldControlClass}
      />
      <ComboboxListbox
        combobox={combobox}
        options={options}
        label={label}
        emptyMessage={emptyMessage}
        loading={loading}
        loadingMessage={loadingMessage}
        className="absolute start-0 top-full mt-1 w-full"
      />
    </div>
  );
}
