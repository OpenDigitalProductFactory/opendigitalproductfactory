import { expect, type Locator } from "@playwright/test";

export type QuotaControlState = {
  connected: boolean; visible: boolean; disabled: boolean; busy: boolean;
  opacity: number; animations: number; color: string; backgroundColor: string;
  transitionDuration: string;
};

export async function readQuotaControlState(control: Locator, timeout = 1000): Promise<QuotaControlState> {
  // No nested browser callbacks requiring the tsx __name runtime. Resolve the
  // locator again on every poll, rather than retaining a detached React node.
  return control.evaluate(element => {
    const style = getComputedStyle(element);
    let animations = 0;
    for (const animation of element.getAnimations({ subtree: true })) {
      if (animation.playState === "running" || animation.pending) animations++;
    }
    return {
      connected: element.isConnected,
      visible: element.getClientRects().length > 0 && style.visibility === "visible",
      disabled: element.matches(":disabled"), busy: element.getAttribute("aria-busy") === "true",
      opacity: Number(style.opacity), animations, color: style.color,
      backgroundColor: style.backgroundColor, transitionDuration: style.transitionDuration,
    };
  }, undefined, { timeout });
}

export function isQuotaControlSettled(state: QuotaControlState): boolean {
  return state.connected && state.visible && !state.disabled && !state.busy
    && Number.isFinite(state.opacity) && state.opacity > 0 && state.animations === 0;
}

/** Observe completion, not a preferred color/opacity. Axe must still reject a
 * settled enabled control with poor contrast. Never change styles to pass. */
export async function waitForQuotaControlSettlement(control: Locator, timeout = 10_000): Promise<QuotaControlState> {
  let measured: QuotaControlState | undefined;
  const deadline = Date.now() + timeout;
  try {
    await expect(async () => {
      measured = await readQuotaControlState(control, Math.max(1, deadline - Date.now()));
      expect(isQuotaControlSettled(measured)).toBe(true);
    }).toPass({ timeout });
  } catch (cause) {
    throw new Error(`Quota control did not settle: ${JSON.stringify(measured ?? null)}`, { cause });
  }
  return measured!;
}
