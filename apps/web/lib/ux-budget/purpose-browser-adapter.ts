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
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  };

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
      element.textContent?.trim() || element.getAttribute("title")?.trim() || ""
    );
  };

  const semanticRole = (element: HTMLElement): string | null => {
    const explicitRole = element.getAttribute("role")?.trim();
    if (explicitRole) return explicitRole;
    if (element instanceof HTMLButtonElement) return "button";
    if (element instanceof HTMLAnchorElement && element.hasAttribute("href")) {
      return "link";
    }
    return null;
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
      return false;
    }
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit && (hit === element || element.contains(hit)));
  };

  const meaningful = (element: HTMLElement): boolean =>
    visible(element) && Boolean(element.textContent?.trim());

  const operable = (element: HTMLElement): boolean =>
    accessibleName(element).length > 0 &&
    (semanticRole(element) === "button" || semanticRole(element) === "link") &&
    enabled(element) &&
    focusable(element) &&
    unobstructed(element);

  const meaningfulMarkerPresent = (selector: string): boolean =>
    [...root.querySelectorAll<HTMLElement>(selector)].some(meaningful);

  const actions = [
    ...root.querySelectorAll<HTMLElement>("[data-dpf-purpose-action-key]"),
  ].map((element) => {
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
  });
  const recoveryAction = actions.find(
    (action) => action.key === "open-recovery-guidance",
  );
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
    h1Count: root.querySelectorAll("h1").length,
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
      .filter(meaningful)
      .map((element) => element.dataset.dpfPurposeCompletionSignalKey ?? "")
      .filter(Boolean),
    correctionSignalKeys: [
      ...root.querySelectorAll<HTMLElement>(
        "[data-dpf-purpose-correction-signal-key]",
      ),
    ]
      .filter(meaningful)
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
