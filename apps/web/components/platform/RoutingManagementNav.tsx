"use client";
import { useT } from "@/lib/i18n/use-t";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { readRoutingScope, routingHref, type RoutingScope } from "@/lib/ai-operations-map/routing-management-scope";
const MAP = "/platform/ai/operations-map";
const PROVIDERS = "/platform/ai/providers";
/** The persistent AI layout carries scope through existing provider links, including detail routes. */
export function RoutingManagementNav() {
    const t = useT("routingManagement");
    const pathname = usePathname();
    const params = useSearchParams();
    const prior = useRef<RoutingScope | null>(null);
    const supported = pathname === MAP || pathname === PROVIDERS || pathname.startsWith(`${PROVIDERS}/`);
    let scope = params.has("routingWindow") ? readRoutingScope(params) : prior.current ?? readRoutingScope(params);
    const detailId = pathname.startsWith(`${PROVIDERS}/`) ? decodeURIComponent(pathname.slice(PROVIDERS.length + 1).split("/")[0]) : null;
    if (detailId)
        scope = { ...scope, provider: detailId };
    useEffect(() => {
        if (!supported)
            return;
        prior.current = scope;
        // Existing provider catalog/detail controls keep their current ownership.
        // Carry context in the URL when those links omit it, so reload remains durable.
        if (!params.has("routingWindow") || (detailId && params.get("routingProvider") !== detailId)) {
            window.history.replaceState(null, "", routingHref(`${pathname}?${params}`, scope));
        }
    }, [supported, pathname, params, scope.view, scope.task, scope.provider, scope.data, scope.minutes, detailId]);
    if (!supported)
        return null;
    return <nav aria-label={t("routingManagement")} className="mb-3 flex flex-wrap items-center gap-2 border-b border-[var(--dpf-border)] pb-3">
    {[
            { label: t("traffic"), href: routingHref(MAP, { ...scope, view: "traffic" }), active: pathname === MAP && scope.view === "traffic" },
            { label: t("evaluation"), href: routingHref(MAP, { ...scope, view: "evaluation" }), active: pathname === MAP && scope.view === "evaluation" },
            { label: t("providers"), href: routingHref(PROVIDERS, scope), active: pathname.startsWith(PROVIDERS) },
        ].map(item => <Link key={item.label} href={item.href} aria-current={item.active ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] ${item.active ? "bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]" : "text-[var(--dpf-muted)] hover:bg-[var(--dpf-surface-2)]"}`}>{item.label}</Link>)}
    {pathname.startsWith(PROVIDERS) && <span className="min-w-0 text-xs text-[var(--dpf-muted)]">{t("routingContext")}{scope.task === "all" ? t("allTasks") : scope.task} · {scope.data}{t("dataLabel")}{scope.minutes < 1440 ? t("min", { p0: scope.minutes }) : t("days", { p0: scope.minutes / 1440 })}</span>}
  </nav>;
}
