"use client";

// Universal Grid & Workbooks — styled dropdown (EP-GRID-REFINEMENT POC).
//
// A design-system dropdown to replace the grid's raw native <select>s: a button
// trigger (value + chevron) that opens a floating listbox with hover/active
// states, an optional per-option icon, and a check on the selected row. Built on
// @floating-ui/react (portal, flip/shift, keyboard list-nav, dismiss) + lucide,
// so the grid's menus read as "designed" rather than OS-default. Keyboard- and
// screen-reader-accessible (role=listbox/option, arrow nav, Enter/Escape).

import { useRef, useState, type ReactNode } from "react";
import {
  useFloating,
  offset,
  flip,
  shift,
  size,
  autoUpdate,
  useClick,
  useDismiss,
  useRole,
  useListNavigation,
  useInteractions,
  FloatingPortal,
  FloatingFocusManager,
} from "@floating-ui/react";
import { ChevronDown, Check } from "lucide-react";

export interface GridSelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export interface GridSelectProps {
  value: string;
  options: GridSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  /** Shown when no option matches `value` (e.g. an "add…" affordance). */
  placeholder?: string;
  /** Compact trigger (used inside chips) drops the border/background. */
  variant?: "default" | "bare";
}

export function GridSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  variant = "default",
}: GridSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<Array<HTMLElement | null>>([]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        apply({ availableHeight, elements }) {
          elements.floating.style.maxHeight = `${Math.min(availableHeight, 320)}px`;
        },
        padding: 8,
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "listbox" });
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    loop: true,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    click,
    dismiss,
    role,
    listNav,
  ]);

  const selected = options.find((o) => o.value === value);

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        {...getReferenceProps()}
        className={variant === "bare" ? "dpf-grid-select dpf-grid-select-bare" : "dpf-grid-select"}
      >
        {selected?.icon}
        <span className="dpf-grid-select-label">{selected ? selected.label : (placeholder ?? "")}</span>
        <ChevronDown size={14} aria-hidden className="dpf-grid-select-chevron" />
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps()}
              className="dpf-grid-menu"
            >
              {options.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  ref={(node) => {
                    listRef.current[i] = node;
                  }}
                  {...getItemProps({
                    onClick: () => {
                      onChange(o.value);
                      setOpen(false);
                    },
                  })}
                  className={`dpf-grid-menu-item${activeIndex === i ? " is-active" : ""}${
                    o.value === value ? " is-selected" : ""
                  }`}
                >
                  {o.icon}
                  <span className="dpf-grid-menu-item-label">{o.label}</span>
                  {o.value === value && <Check size={14} aria-hidden />}
                </button>
              ))}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
