// apps/web/components/shell/Header.tsx
import Link from "next/link";
import { signOutAction } from "@/lib/actions";

type Props = {
  activePath: string;
  platformRole: string | null;
};

const NAV_ITEMS = [
  { label: "My Workspace", href: "/workspace" },
  { label: "Directory", href: "/directory" },
  { label: "Activity", href: "/activity" },
];

export function Header({ activePath, platformRole }: Props) {
  return (
    <header className="flex items-center justify-between px-4 py-2 bg-[var(--dpf-surface-1)] border-b border-[var(--dpf-border)]">
      <div className="flex items-center gap-3">
        <span className="font-extrabold text-[var(--dpf-accent)] tracking-tight text-sm">DPF</span>
        <nav className="flex gap-1">
          {NAV_ITEMS.map((item) => {
            const active = activePath === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  active
                    ? "bg-[var(--dpf-accent)] text-white"
                    : "text-[var(--dpf-muted)] hover:text-white border border-[var(--dpf-border)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border border-[var(--dpf-accent)] text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)] hover:text-white transition-colors"
        >
          <span>Agent</span>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
        </button>
        {platformRole !== null && (
          <span className="text-xs text-[var(--dpf-muted)]">{platformRole}</span>
        )}
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-xs text-[var(--dpf-muted)] hover:text-white transition-colors"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
