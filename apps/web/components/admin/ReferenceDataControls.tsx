"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ReferenceTypeahead } from "@/components/ui/ReferenceTypeahead";
import {
  buildReferenceDataHref,
  type PageWindow,
  type ReferenceDataSearchParams,
} from "@/lib/admin/reference-data-read-model";

type RefItem = { id: string; label: string };

function currentParams(
  searchParams: ReturnType<typeof useSearchParams>,
): ReferenceDataSearchParams {
  return Object.fromEntries(searchParams.entries());
}

export function ReferenceDataSearch({
  inputId,
  label,
  query,
  queryParam,
  pageParam,
  placeholder,
}: {
  inputId: string;
  label: string;
  query: string;
  queryParam: string;
  pageParam: string;
  placeholder: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(query);

  useEffect(() => setValue(query), [query]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(
      buildReferenceDataHref(currentParams(searchParams), {
        [queryParam]: value,
        [pageParam]: null,
      }),
    );
  }

  return (
    <form onSubmit={submit} className="space-y-1.5">
      <label
        htmlFor={inputId}
        className="block text-xs font-medium text-[var(--dpf-muted)]"
      >
        {label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={inputId}
          type="search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded bg-[var(--dpf-accent)] px-3 py-2 text-xs font-medium text-white"
          >
            Search
          </button>
          {query && (
            <button
              type="button"
              onClick={() => {
                setValue("");
                router.push(
                  buildReferenceDataHref(currentParams(searchParams), {
                    [queryParam]: null,
                    [pageParam]: null,
                  }),
                );
              }}
              className="rounded border border-[var(--dpf-border)] px-3 py-2 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

export function ReferenceDataParentPicker({
  inputId,
  label,
  value,
  placeholder,
  paramName,
  resetParams,
  onSearch,
}: {
  inputId: string;
  label: string;
  value: RefItem | null;
  placeholder: string;
  paramName: string;
  resetParams: string[];
  onSearch: (query: string) => Promise<RefItem[]>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(item: RefItem | null) {
    const patch: Record<string, string | null> = {
      [paramName]: item?.id ?? null,
    };
    for (const param of resetParams) patch[param] = null;
    router.push(buildReferenceDataHref(currentParams(searchParams), patch));
  }

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={inputId}
        className="block text-xs font-medium text-[var(--dpf-muted)]"
      >
        {label}
      </label>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <ReferenceTypeahead
            inputId={inputId}
            value={value}
            placeholder={placeholder}
            onSearch={onSearch}
            onSelect={navigate}
          />
        </div>
        {value && (
          <button
            type="button"
            onClick={() => navigate(null)}
            className="rounded border border-[var(--dpf-border)] px-3 py-2 text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

export function ReferenceDataPagination({
  label,
  window,
  pageParam,
}: {
  label: string;
  window: PageWindow;
  pageParam: string;
}) {
  const searchParams = useSearchParams();
  if (window.pageCount <= 1) return null;

  const params = currentParams(searchParams);
  const previousHref =
    window.page > 1
      ? buildReferenceDataHref(params, {
          [pageParam]: window.page === 2 ? null : String(window.page - 1),
        })
      : null;
  const nextHref =
    window.page < window.pageCount
      ? buildReferenceDataHref(params, {
          [pageParam]: String(window.page + 1),
        })
      : null;

  return (
    <nav
      aria-label={label}
      className="flex flex-col gap-2 border-t border-[var(--dpf-border)] pt-3 text-xs sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-[var(--dpf-muted)]">
        Page <span aria-current="page">{window.page}</span> of{" "}
        {window.pageCount} · {window.total.toLocaleString()} results
      </p>
      <div className="flex items-center gap-2">
        {previousHref ? (
          <Link
            href={previousHref}
            className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]"
          >
            Previous
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-[var(--dpf-muted)] opacity-50"
          >
            Previous
          </span>
        )}
        {nextHref ? (
          <Link
            href={nextHref}
            className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-[var(--dpf-muted)] hover:text-[var(--dpf-foreground)]"
          >
            Next
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-[var(--dpf-muted)] opacity-50"
          >
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
