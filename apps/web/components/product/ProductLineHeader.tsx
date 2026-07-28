import Link from "next/link";

export function ProductLineHeader({
  line,
  providerName,
}: {
  line: { id: string; name: string };
  providerName: string;
}) {
  return (
    <header className="mb-dpf-md">
      <nav
        aria-label="Breadcrumb"
        className="mb-dpf-md flex items-center gap-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]"
      >
        <Link href="/portfolio" className="hover:text-[var(--dpf-text)]">
          Products
        </Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page" className="text-[var(--dpf-text)]">
          {line.name}
        </span>
      </nav>
      <div className="flex flex-wrap items-center gap-dpf-sm">
        <h1 className="text-dpf-heading font-dpf-semibold text-[var(--dpf-text)]">
          {line.name}
        </h1>
        <span className="rounded-dpf-sm border border-[var(--dpf-border)] px-dpf-sm py-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]">
          Product line
        </span>
      </div>
      <p className="mt-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]">
        Provided by {providerName}
      </p>
    </header>
  );
}
