import Link from "next/link";
import type {
  FamiliesSectionNavConfig,
  FlatSectionNavConfig,
  GroupedSectionNavConfig,
  SectionNavConfig,
  SectionNavLink,
  SectionNavTab,
} from "@/lib/navigation/section-nav-model";

// One renderer for every portal section nav (BI-ARCH-SECTIONNAV). It is pure and
// presentational: callers resolve active state with their own `usePathname` rules
// and pass a fully-resolved SectionNavConfig. The styles below reproduce the exact
// markup the per-surface *TabNav components used to each carry.
//
// All colors are --dpf-* tokens (AGENTS.md §12). To add a section nav, build a
// SectionNavConfig from your domain nav data and render <SectionNav> — do not
// clone a *TabNav.

export function SectionNav({ config }: { config: SectionNavConfig }) {
  if (config.variant === "grouped") {
    return <GroupedNav config={config} />;
  }
  if (config.variant === "flat") {
    return <FlatNav config={config} />;
  }
  return <FamiliesNav config={config} />;
}

function FamiliesNav({ config }: { config: FamiliesSectionNavConfig }) {
  const { style, dense, families, description, subItems, dataComponent } = config;

  const familyTabs = (
    <div
      className={
        style === "pill"
          ? "flex flex-wrap gap-2 border-b border-[var(--dpf-border)] pb-2"
          : "flex gap-1 overflow-x-auto border-b border-[var(--dpf-border)]"
      }
    >
      {families.map((family) => (
        <Link key={family.key} href={family.href} className={familyClass(style, family.active)}>
          {family.label}
        </Link>
      ))}
    </div>
  );

  if (style === "tab") {
    return (
      <div className="mb-6" data-component={dataComponent}>
        {familyTabs}
        {subItems.length > 0 && (
          <div className="rounded-b-xl border border-t-0 border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3">
            {description ? <p className="text-xs text-[var(--dpf-muted)]">{description}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {subItems.map((item) => (
                <Link key={item.href} href={item.href} className={subItemClass("tab", item.active)}>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // pill
  return (
    <div className={dense ? "mb-3 space-y-2" : "mb-6 space-y-3"} data-component={dataComponent}>
      {familyTabs}
      <div className={dense ? "space-y-1" : "space-y-2"}>
        <p className={dense ? "sr-only" : "text-sm text-[var(--dpf-muted)]"}>{description}</p>
        <div className="flex flex-wrap gap-2">
          {subItems.map((item) => (
            <Link key={item.href} href={item.href} className={subItemClass("pill", item.active)}>
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function GroupedNav({ config }: { config: GroupedSectionNavConfig }) {
  return (
    <div
      className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-[var(--dpf-border)]"
      data-component={config.dataComponent}
    >
      {config.groups.map((group) => (
        <div key={group.label} className="min-w-0 max-w-full flex flex-col gap-1">
          <span className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
            {group.label}
          </span>
          <div className="flex flex-wrap gap-1">
            {group.tabs.map((tab) => (
              <Link key={tab.href} href={tab.href} className={tabLinkClass(tab.active)}>
                {tab.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FlatNav({ config }: { config: FlatSectionNavConfig }) {
  const { tone = "underline", as = "div", wrap = false, tabs, dataComponent } = config;
  const Root = as === "nav" ? "nav" : "div";

  // Underline default matches EA/Audit/Workforce/Identity (gap-1). `wrap` matches
  // Customer (flex-wrap gap-x-1 gap-y-2). Pill matches Marketing (a bottom-padded
  // bordered strip of rounded-full pills). Emphasis matches the Storefront admin
  // strip (heavier tabs, gap-0).
  const containerClass =
    tone === "pill"
      ? "mb-6 flex flex-wrap gap-2 border-b border-[var(--dpf-border)] pb-3"
      : tone === "emphasis"
        ? "mb-6 flex flex-wrap gap-0 border-b border-[var(--dpf-border)]"
        : wrap
          ? "mb-6 flex flex-wrap gap-x-1 gap-y-2 border-b border-[var(--dpf-border)]"
          : "flex gap-1 mb-6 border-b border-[var(--dpf-border)]";

  return (
    <Root className={containerClass} data-component={dataComponent}>
      {tabs.map((tab) => {
        const className = flatTabClass(tone, tab.active);
        if (tab.href !== undefined) {
          return (
            <Link key={tab.key} href={tab.href} className={className}>
              {tab.label}
            </Link>
          );
        }
        return (
          <button key={tab.key} type="button" onClick={tab.onSelect} className={className}>
            {tab.label}
          </button>
        );
      })}
    </Root>
  );
}

function flatTabClass(tone: "underline" | "pill" | "emphasis", active: boolean): string {
  if (tone === "pill") {
    return [
      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
      active
        ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
        : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
    ].join(" ");
  }
  if (tone === "emphasis") {
    return [
      "whitespace-nowrap px-4 py-2.5 text-[13px] no-underline transition-colors",
      active
        ? "border-b-2 border-[var(--dpf-accent)] font-semibold text-[var(--dpf-accent)]"
        : "border-b-2 border-transparent font-normal text-[var(--dpf-muted)]",
    ].join(" ");
  }
  return tabLinkClass(active);
}

function familyClass(style: "pill" | "tab", active: boolean): string {
  if (style === "tab") return tabLinkClass(active, "whitespace-nowrap rounded-t px-3 py-1.5 text-xs font-medium");
  return [
    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
    active
      ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)]/10 text-[var(--dpf-text)]"
      : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
  ].join(" ");
}

function subItemClass(style: "pill" | "tab", active: boolean): string {
  if (style === "tab") {
    return [
      "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
      active
        ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
        : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
    ].join(" ");
  }
  return [
    "rounded-full border px-2.5 py-1 text-xs transition-colors",
    active
      ? "border-[var(--dpf-accent)] text-[var(--dpf-text)]"
      : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
  ].join(" ");
}

function tabLinkClass(active: boolean, base = "rounded-t px-3 py-1.5 text-xs font-medium"): string {
  return [
    `${base} transition-colors`,
    active
      ? "border-b-2 border-[var(--dpf-accent)] text-[var(--dpf-text)]"
      : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
  ].join(" ");
}

export type { SectionNavLink, SectionNavTab };
