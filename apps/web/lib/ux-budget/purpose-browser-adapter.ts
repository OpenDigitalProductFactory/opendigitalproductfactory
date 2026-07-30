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
      .map((element) => element.dataset.dpfPurposeKey ?? "")
      .filter(Boolean),
    actions,
    messages: [
      ...root.querySelectorAll<HTMLElement>(
        "[data-dpf-purpose-message-key]",
      ),
    ]
      .map((element) => element.dataset.dpfPurposeMessageKey ?? "")
      .filter(Boolean),
    prohibitedActionKeysPresent: [],
    completionSignalKeys: [
      ...root.querySelectorAll<HTMLElement>(
        "[data-dpf-purpose-completion-signal-key]",
      ),
    ]
      .map((element) => element.dataset.dpfPurposeCompletionSignalKey ?? "")
      .filter(Boolean),
    correctionSignalKeys: [
      ...root.querySelectorAll<HTMLElement>(
        "[data-dpf-purpose-correction-signal-key]",
      ),
    ]
      .map((element) => element.dataset.dpfPurposeCorrectionSignalKey ?? "")
      .filter(Boolean),
    recoverySignal: {
      present: Boolean(
        root.querySelector("[data-dpf-purpose-recovery-signal]") &&
          recoveryAction,
      ),
      actionKey: recoveryAction?.key ?? null,
      routePath: recoveryAction?.href ?? null,
    },
    disclosures,
    consequentialAction: {
      consequenceVisible: Boolean(
        root.querySelector("[data-dpf-purpose-consequence]"),
      ),
      reversibilityVisible: Boolean(
        root.querySelector("[data-dpf-purpose-reversibility]"),
      ),
      confirmationAvailable: Boolean(
        root.querySelector("[data-dpf-purpose-confirmation]"),
      ),
      authorityVisible: Boolean(
        root.querySelector("[data-dpf-purpose-authority]"),
      ),
      recoveryVisible: Boolean(
        root.querySelector("[data-dpf-purpose-recovery-context]"),
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
