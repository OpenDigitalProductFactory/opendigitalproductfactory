import { useId, type ReactNode } from "react";
import { Surface } from "@/components/ui/Surface";

/** One disclosure owner preserves provider tools without multiplying route homes. */
export function ProviderDetailSections({ sections }: {
  sections: Array<{ key: string; title: string; summary?: string; content: ReactNode; open?: boolean }>;
}) {
  const id = useId();
  return <div className="space-y-2">{sections.map(section => <Surface key={section.key} padding="none"><details id={`${id}-${section.key}`} open={section.open}
    className="px-3 py-2">
    <summary className="cursor-pointer py-2 text-sm font-semibold text-[var(--dpf-text)]">{section.title}
      {section.summary && <span className="ms-2 font-normal text-[var(--dpf-muted)]">{section.summary}</span>}
    </summary>
    <div className="mt-2 min-w-0">{section.content}</div>
  </details></Surface>)}</div>;
}
