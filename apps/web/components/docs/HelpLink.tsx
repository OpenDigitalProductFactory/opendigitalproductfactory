"use client";

import Link from "next/link";

type Props = {
  docsPath: string;
};

export function HelpLink({ docsPath }: Props) {
  return (
    <Link
      href={docsPath}
      title="View documentation"
      className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-accent)] hover:border-[var(--dpf-accent)] transition-colors text-[10px]"
    >
      ?
    </Link>
  );
}
