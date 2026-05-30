// apps/web/components/ui/report-kit/FilterBar.tsx
//
// Composable filter row for the reporting palette. Unifies the three idioms
// currently scattered across surfaces (URL link-pills, <select> forms, client
// useState buttons) behind one facet model.
//
// Two modes:
//   - "client": controlled via `value` + `onChange` (matches complaints today).
//   - "url":    server-friendly. Pills are <Link>s whose hrefs are built from a
//               `basePath` + the current `value` (no function prop, so it can be
//               rendered directly from a Server Component). search/select render
//               as GET forms that preserve the other facets via hidden inputs.
//
// url mode is intentionally function-free: passing a callback from a Server
// Component to this ("use client") component is not allowed, so the href is
// derived internally from serializable props.

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
  basePath?: never;
}

interface UrlProps extends CommonProps {
  mode: "url";
  /** Route the filter links/forms target, e.g. "/finance/payments". */
  basePath: string;
  onChange?: never;
}

export type FilterBarProps = ClientProps | UrlProps;

const PILL_BASE = "rounded border px-2 py-0.5 text-[11px] transition-colors";

function pillClass(active: boolean): string {
  return active
    ? `${PILL_BASE} border-[var(--dpf-accent)] text-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)]`
    : `${PILL_BASE} border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]`;
}

/** Merge `key`→`next` into the current filter set and serialize to an href. */
function buildHref(
  basePath: string,
  value: Record<string, string>,
  key: string,
  next: string | null,
): string {
  const merged: Record<string, string> = { ...value };
  if (next === null || next === "") delete merged[key];
  else merged[key] = next;
  const params = Object.entries(merged).filter(([, v]) => v != null && v !== "");
  const qs = new URLSearchParams(params).toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Hidden inputs carrying every facet value except `exceptKey` (url forms). */
function hiddenInputs(value: Record<string, string>, exceptKey: string) {
  return Object.entries(value)
    .filter(([k, v]) => k !== exceptKey && v)
    .map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
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
          if (isUrl) {
            return (
              <form key={facet.key} action={props.basePath} method="get">
                {hiddenInputs(value, facet.key)}
                <input
                  type="search"
                  name={facet.key}
                  aria-label={facet.placeholder ?? "Search"}
                  placeholder={facet.placeholder ?? "Search…"}
                  defaultValue={current}
                  className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-xs"
                />
              </form>
            );
          }
          return (
            <input
              key={facet.key}
              type="search"
              aria-label={facet.placeholder ?? "Search"}
              placeholder={facet.placeholder ?? "Search…"}
              defaultValue={current}
              onChange={(e) => set(facet.key, e.target.value)}
              className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-xs"
            />
          );
        }

        if (facet.kind === "select") {
          if (isUrl) {
            return (
              <form
                key={facet.key}
                action={props.basePath}
                method="get"
                className="flex items-center gap-1 text-[11px]"
              >
                {hiddenInputs(value, facet.key)}
                <span className="text-[var(--dpf-muted)]">{facet.label}</span>
                <select
                  name={facet.key}
                  defaultValue={current}
                  aria-label={facet.label}
                  className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-xs"
                >
                  <option value="">All</option>
                  {facet.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded border border-[var(--dpf-border)] px-2 py-1 text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                >
                  Apply
                </button>
              </form>
            );
          }
          return (
            <label key={facet.key} className="flex items-center gap-1 text-[11px]">
              <span className="text-[var(--dpf-muted)]">{facet.label}</span>
              <select
                value={current}
                aria-label={facet.label}
                onChange={(e) => set(facet.key, e.target.value)}
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
                    href={buildHref(props.basePath, value, facet.key, active ? null : opt.value)}
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
