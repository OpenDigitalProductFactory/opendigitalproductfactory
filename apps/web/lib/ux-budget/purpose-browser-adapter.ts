import type { Page } from "@playwright/test";

import type { RatifiedPurposeContract } from "./page-purpose";
import {
  evaluateRoutePurpose,
  type PurposeDomEvidence,
  type PurposeStateOracle,
  type RoutePurposeEvaluation,
} from "./purpose-evaluator";

export const BROWSER_EVALUATION_RUNTIME =
  "globalThis.__name = (target, value) => Object.defineProperty(target, 'name', { value, configurable: true })";

export function capturePurposeEvidenceFromDom(): PurposeDomEvidence | null {
  const root = document.querySelector<HTMLElement>("[data-dpf-purpose-route]");
  if (!root) return null;

  const visible = (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    if (
      element.closest("[hidden], [aria-hidden='true'], [inert]") ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return false;
    }
    let current: HTMLElement | null = element as HTMLElement;
    while (current) {
      const style = getComputedStyle(current);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        Number.parseFloat(style.opacity || "1") <= 0
      ) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  };

  const visibleDescendantText = (element: Element): string =>
    [...element.childNodes]
      .map((node) => {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
        return node instanceof Element && visible(node)
          ? visibleDescendantText(node)
          : "";
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

  const accessibleName = (element: HTMLElement): string => {
    const directLabel = element.getAttribute("aria-label")?.trim();
    if (directLabel) return directLabel;
    const labelledBy = element.getAttribute("aria-labelledby")?.trim();
    if (labelledBy) {
      const label = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      if (label) return label;
    }
    return (
      visibleDescendantText(element) ||
      element.getAttribute("title")?.trim() ||
      ""
    );
  };

  const semanticRole = (element: HTMLElement): string | null => {
    const nativeRole =
      element instanceof HTMLButtonElement
        ? "button"
        : element instanceof HTMLAnchorElement && element.hasAttribute("href")
          ? "link"
          : null;
    if (!nativeRole) return null;
    const explicitRole = element.getAttribute("role")?.trim();
    return explicitRole || nativeRole;
  };

  const enabled = (element: HTMLElement): boolean => {
    if (element.getAttribute("aria-disabled") === "true") return false;
    if (
      element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    ) {
      return !element.disabled;
    }
    return true;
  };

  const focusable = (element: HTMLElement): boolean => {
    if (!visible(element) || !enabled(element)) return false;
    if (element.tabIndex >= 0) return true;
    if (element instanceof HTMLAnchorElement) return element.hasAttribute("href");
    return element.isContentEditable;
  };

  const unobstructed = (element: HTMLElement): boolean => {
    if (!visible(element) || typeof document.elementFromPoint !== "function") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      return true;
    }
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit && (hit === element || element.contains(hit)));
  };

  const meaningful = (element: HTMLElement): boolean =>
    visible(element) &&
    Boolean(visibleDescendantText(element)) &&
    unobstructed(element);

  const operable = (element: HTMLElement): boolean =>
    accessibleName(element).length > 0 &&
    (semanticRole(element) === "button" || semanticRole(element) === "link") &&
    enabled(element) &&
    focusable(element) &&
    unobstructed(element);

  const evidenceBearing = (element: HTMLElement): boolean =>
    meaningful(element) || operable(element);

  const meaningfulMarkerPresent = (selector: string): boolean =>
    [...root.querySelectorAll<HTMLElement>(selector)].some(meaningful);

  const describeAction = (
    element: HTMLElement,
  ): PurposeDomEvidence["actions"][number] => {
    const rect = element.getBoundingClientRect();
    const href =
      element instanceof HTMLAnchorElement
        ? new URL(element.href, location.href).pathname
        : undefined;
    return {
      key: element.dataset.dpfPurposeActionKey ?? "",
      primary: element.hasAttribute("data-dpf-primary-action"),
      visible: visible(element),
      accessibleName: accessibleName(element),
      semanticRole: semanticRole(element),
      enabled: enabled(element),
      focusable: focusable(element),
      unobstructed: unobstructed(element),
      geometry: {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      },
      ...(href ? { href } : {}),
    };
  };
  const actions = [
    ...root.querySelectorAll<HTMLElement>("[data-dpf-purpose-action-key]"),
  ].map(describeAction);
  const recoveryActionElement = root.querySelector<HTMLElement>(
    "[data-dpf-purpose-recovery-action][data-dpf-purpose-action-key]",
  );
  const recoveryAction = recoveryActionElement
    ? describeAction(recoveryActionElement)
    : undefined;
  const disclosures = [
    ...root.querySelectorAll<HTMLElement>(
      "[data-dpf-purpose-disclosure-key]",
    ),
  ].map((container) => {
    const key = container.dataset.dpfPurposeDisclosureKey ?? "";
    const trigger = container.querySelector<HTMLElement>(
      "[data-dpf-purpose-disclosure-trigger]",
    );
    const region = container.querySelector<HTMLElement>(
      "[data-dpf-purpose-disclosure-region]",
    );
    const controlledId = trigger?.getAttribute("aria-controls");
    return {
      key,
      triggerPresent: Boolean(trigger),
      controlledRegionPresent: Boolean(region),
      relationshipValid:
        Boolean(trigger && region) &&
        (container instanceof HTMLDetailsElement ||
          (Boolean(controlledId) && region?.id === controlledId)),
      expanded:
        container instanceof HTMLDetailsElement
          ? container.open
          : trigger?.getAttribute("aria-expanded") === "true",
    };
  });

  return {
    routePath: root.dataset.dpfPurposeRoute ?? null,
    stateKey: root.dataset.dpfPurposeState ?? null,
    h1Count: [...root.querySelectorAll<HTMLElement>("h1")].filter(meaningful)
      .length,
    purposeKeys: [
      ...root.querySelectorAll<HTMLElement>("[data-dpf-purpose-key]"),
    ]
      .filter(meaningful)
      .map((element) => element.dataset.dpfPurposeKey ?? "")
      .filter(Boolean),
    actions,
    messages: [
      ...root.querySelectorAll<HTMLElement>(
        "[data-dpf-purpose-message-key]",
      ),
    ]
      .filter(meaningful)
      .map((element) => element.dataset.dpfPurposeMessageKey ?? "")
      .filter(Boolean),
    prohibitedActionKeysPresent: [],
    completionSignalKeys: [
      ...root.querySelectorAll<HTMLElement>(
        "[data-dpf-purpose-completion-signal-key]",
      ),
    ]
      .filter(evidenceBearing)
      .map((element) => element.dataset.dpfPurposeCompletionSignalKey ?? "")
      .filter(Boolean),
    correctionSignalKeys: [
      ...root.querySelectorAll<HTMLElement>(
        "[data-dpf-purpose-correction-signal-key]",
      ),
    ]
      .filter(evidenceBearing)
      .map((element) => element.dataset.dpfPurposeCorrectionSignalKey ?? "")
      .filter(Boolean),
    recoverySignal: {
      present: Boolean(
        meaningfulMarkerPresent("[data-dpf-purpose-recovery-signal]") &&
          recoveryAction &&
          recoveryAction.visible &&
          recoveryAction.accessibleName &&
          (recoveryAction.semanticRole === "button" ||
            recoveryAction.semanticRole === "link") &&
          recoveryAction.enabled &&
          recoveryAction.focusable &&
          recoveryAction.unobstructed,
      ),
      actionKey: recoveryAction?.key ?? null,
      routePath: recoveryAction?.href ?? null,
    },
    disclosures,
    consequentialAction: {
      consequenceVisible: Boolean(
        meaningfulMarkerPresent("[data-dpf-purpose-consequence]"),
      ),
      reversibilityVisible: Boolean(
        meaningfulMarkerPresent("[data-dpf-purpose-reversibility]"),
      ),
      confirmationAvailable: Boolean(
        [...root.querySelectorAll<HTMLElement>("[data-dpf-purpose-confirmation]")]
          .some(operable),
      ),
      authorityVisible: Boolean(
        meaningfulMarkerPresent("[data-dpf-purpose-authority]"),
      ),
      recoveryVisible: Boolean(
        meaningfulMarkerPresent("[data-dpf-purpose-recovery-context]"),
      ),
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  };
}

export async function capturePurposeEvidence(
  page: Page,
): Promise<PurposeDomEvidence | null> {
  await page.evaluate(BROWSER_EVALUATION_RUNTIME);
  return page.evaluate(capturePurposeEvidenceFromDom);
}

export async function evaluateCurrentPurposePage(
  page: Page,
  contract: RatifiedPurposeContract,
): Promise<RoutePurposeEvaluation> {
  const oraclePath = `/api${contract.routePath}/purpose-state`;
  const oracle = await page.evaluate(async (path) => {
    const response = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(`purpose oracle returned http ${response.status}`);
    }
    return response.json();
  }, oraclePath) as PurposeStateOracle;

  return evaluateRoutePurpose({
    contract,
    oracle,
    evidence: await capturePurposeEvidence(page),
    enforcement: "advisory",
  });
}
