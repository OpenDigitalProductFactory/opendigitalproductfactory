"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ReferenceTypeahead } from "@/components/ui/ReferenceTypeahead";
import {
  FormField,
  SubmitButton,
  fieldControlClass,
} from "@/components/ui/form";
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
  label,
  query,
  queryParam,
  pageParam,
  placeholder,
}: {
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
      <div className="flex flex-col gap-2 sm:flex-row">
        <FormField name={queryParam} label={label} className="min-w-0 flex-1">
          {(control) => (
            <input
              {...control}
              type="search"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={placeholder}
              autoComplete="off"
              className={fieldControlClass}
            />
          )}
        </FormField>
        <div className="flex items-end gap-2">
          <SubmitButton>
            Search
          </SubmitButton>
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
  label,
  value,
  placeholder,
  paramName,
  resetParams,
  onSearch,
}: {
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
    <FormField name={paramName} label={label}>
      {(control) => (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <ReferenceTypeahead
              inputId={control.id}
              inputName={control.name}
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
      )}
    </FormField>
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
