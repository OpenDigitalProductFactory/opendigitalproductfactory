"use client";
import { useT } from "@/lib/i18n/use-t";
import { useEffect, useRef } from "react";
import { PlatformTabNav } from "./PlatformTabNav";
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
        if (supported || params.has("routingWindow"))
            prior.current = scope;
        if (!supported)
            return;
        // Existing provider catalog/detail controls keep their current ownership.
        // Carry context in the URL when those links omit it, so reload remains durable.
        if (!params.has("routingWindow") || (detailId && params.get("routingProvider") !== detailId)) {
            window.history.replaceState(null, "", routingHref(`${pathname}?${params}`, scope));
        }
    }, [supported, pathname, params, scope.view, scope.task, scope.provider, scope.data, scope.minutes, detailId]);
    if (!supported)
        return <PlatformTabNav />;
    const items = [
            { label: t("traffic"), href: routingHref(MAP, { ...scope, view: "traffic" }), active: pathname === MAP && scope.view === "traffic" },
            { label: t("evaluation"), href: routingHref(MAP, { ...scope, view: "evaluation" }), active: pathname === MAP && scope.view === "evaluation" },
            { label: t("providers"), href: routingHref(PROVIDERS, scope), active: pathname.startsWith(PROVIDERS) },
            { label: t("allAiWorkspaces"), href: routingHref("/platform/ai/overview", scope), active: false },
        ].map(item => ({ ...item, primary: true }));
    return <>
      <PlatformTabNav workspace={{ label: t("routingManagement"), items }} />
      {pathname.startsWith(PROVIDERS) && <p className="mb-3 text-sm text-[var(--dpf-muted)]" data-routing-scope>{t("routingContext")}{" "}{scope.task === "all" ? t("allTasks") : scope.task} · {t("dataLabel")}{": "}{t(`data.${scope.data as "all" | "public" | "internal" | "confidential" | "restricted"}`)} · {scope.minutes < 1440 ? t("min", { p0: scope.minutes }) : t("days", { p0: scope.minutes / 1440 })}</p>}
    </>;
}
