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
//               rendered directly from a Server Component). search/select facets
//               share ONE GET <form> with a single Apply button; pill values are
//               mirrored as hidden inputs so submitting preserves them.
//
// url mode is intentionally function-free: passing a callback from a Server
// Component to this ("use client") component is not allowed, so hrefs/forms are
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

function pillGroup(
  facet: Extract<FacetDef, { kind: "pills" }>,
  value: Record<string, string>,
  isUrl: boolean,
  basePath: string,
  set: (key: string, next: string) => void,
) {
  const current = value[facet.key] ?? "";
  return (
    <div key={facet.key} className="flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-[var(--dpf-muted)]">{facet.label}</span>
      {facet.options.map((opt) => {
        const active = current === opt.value;
        if (isUrl) {
          return (
            <Link
              key={opt.value}
              href={buildHref(basePath, value, facet.key, active ? null : opt.value)}
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
}

export function FilterBar(props: FilterBarProps) {
  const { facets, value, resultCount, className = "" } = props;
  const isUrl = props.mode === "url";
  const basePath = isUrl ? props.basePath : "";

  function set(key: string, next: string) {
    if (!isUrl) props.onChange({ ...value, [key]: next });
  }

  const pillFacets = facets.filter((f) => f.kind === "pills") as Extract<
    FacetDef,
    { kind: "pills" }
  >[];
  const formFacets = facets.filter((f) => f.kind !== "pills");

  function renderFieldFacet(facet: FacetDef) {
    const current = value[facet.key] ?? "";
    if (facet.kind === "search") {
      return (
        <input
          key={facet.key}
          type="search"
          name={isUrl ? facet.key : undefined}
          aria-label={facet.placeholder ?? "Search"}
          placeholder={facet.placeholder ?? "Search…"}
          defaultValue={isUrl ? current : undefined}
          value={isUrl ? undefined : current}
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
            name={isUrl ? facet.key : undefined}
            aria-label={facet.label}
            defaultValue={isUrl ? current : undefined}
            value={isUrl ? undefined : current}
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
    return null;
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
      {pillFacets.map((facet) => pillGroup(facet, value, isUrl, basePath, set))}

      {formFacets.length > 0 ? (
        isUrl ? (
          <form action={basePath} method="get" className="flex flex-wrap items-center gap-3">
            {/* preserve pill selections across a select/search submit */}
            {pillFacets
              .filter((f) => value[f.key])
              .map((f) => (
                <input key={f.key} type="hidden" name={f.key} value={value[f.key]} />
              ))}
            {formFacets.map(renderFieldFacet)}
            <button
              type="submit"
              className="rounded border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
            >
              Apply
            </button>
          </form>
        ) : (
          formFacets.map(renderFieldFacet)
        )
      ) : null}

      {typeof resultCount === "number" ? (
        <span className="ml-auto text-[11px] text-[var(--dpf-muted)]">
          {resultCount} result{resultCount === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}
