// apps/web/components/ui/report-kit/FilterBar.tsx
//
// Composable filter row for the reporting palette. Unifies the three idioms
// currently scattered across surfaces (URL link-pills, <select> forms, client
// useState buttons) behind one facet model.
//
// Two modes:
//   - "client": controlled via `value` + `onChange` (matches complaints today).
//   - "url":    renders <Link> pills / <select> bound to the given hrefBuilder
//               (server-friendly, matches finance/compliance today).

"use client";

import Link from "next/link";

export type FacetDef =
  | { kind: "search"; key: string; placeholder?: string }
  | { kind: "select"; key: string; label: string; options: FacetOption[] }
  | { kind: "pills"; key: string; label: string; options: FacetOption[] };

export interface FacetOption {
  value: string;
  label: string;
}

interface CommonProps {
  facets: FacetDef[];
  value: Record<string, string>;
  resultCount?: number;
  className?: string;
}

interface ClientProps extends CommonProps {
  mode?: "client";
  onChange: (next: Record<string, string>) => void;
  hrefBuilder?: never;
}

interface UrlProps extends CommonProps {
  mode: "url";
  /** Build the href for a facet set to a value (omit value = cleared). */
  hrefBuilder: (key: string, value: string | null) => string;
  onChange?: never;
}

export type FilterBarProps = ClientProps | UrlProps;

const PILL_BASE =
  "rounded border px-2 py-0.5 text-[11px] transition-colors";

function pillClass(active: boolean): string {
  return active
    ? `${PILL_BASE} border-[var(--dpf-accent)] text-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)]`
    : `${PILL_BASE} border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]`;
}

export function FilterBar(props: FilterBarProps) {
  const { facets, value, resultCount, className = "" } = props;
  const isUrl = props.mode === "url";

  function set(key: string, next: string) {
    if (!isUrl) props.onChange({ ...value, [key]: next });
  }

  return (
    <div
      className={[
        "flex flex-wrap items-center gap-3 text-[var(--dpf-text)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {facets.map((facet) => {
        const current = value[facet.key] ?? "";

        if (facet.kind === "search") {
          return (
            <input
              key={facet.key}
              type="search"
              aria-label={facet.placeholder ?? "Search"}
              placeholder={facet.placeholder ?? "Search…"}
              defaultValue={current}
              onChange={isUrl ? undefined : (e) => set(facet.key, e.target.value)}
              className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-xs"
            />
          );
        }

        if (facet.kind === "select") {
          return (
            <label key={facet.key} className="flex items-center gap-1 text-[11px]">
              <span className="text-[var(--dpf-muted)]">{facet.label}</span>
              <select
                value={current}
                aria-label={facet.label}
                onChange={isUrl ? undefined : (e) => set(facet.key, e.target.value)}
                className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-xs"
              >
                <option value="">All</option>
                {facet.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          );
        }

        // pills
        return (
          <div key={facet.key} className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-[var(--dpf-muted)]">{facet.label}</span>
            {facet.options.map((opt) => {
              const active = current === opt.value;
              if (isUrl) {
                return (
                  <Link
                    key={opt.value}
                    href={props.hrefBuilder(facet.key, active ? null : opt.value)}
                    className={pillClass(active)}
                  >
                    {opt.label}
                  </Link>
                );
              }
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={pillClass(active)}
                  onClick={() => set(facet.key, active ? "" : opt.value)}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        );
      })}

      {typeof resultCount === "number" ? (
        <span className="ml-auto text-[11px] text-[var(--dpf-muted)]">
          {resultCount} result{resultCount === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}
