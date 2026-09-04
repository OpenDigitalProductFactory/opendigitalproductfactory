/**
 * Discovery estate self-heal reconcilers, run once fire-and-forget on boot.
 *
 * Groups the discovery on-boot reconcilers behind one entry so the boot
 * instrumentation stays a single call rather than a growing list of imports:
 *   - backfillDiscoveryAttributionOnBoot (BI-BAF38ED3): re-run the fingerprint
 *     layer over rows a pre-wiring sweep mis-binned as generic servers.
 *   - reconcilePhantomProductsOnBoot (BI-B19C41B8): demote phantom
 *     "LAN Host 192.168.0.N"-per-IP subnet-scan products and platform-internal
 *     rows a pre-fix promotion wrote into the product portfolio.
 *
 * Both are idempotent, cheap once healed, and non-fatal — a failure here must
 * never delay or block boot.
 */
export async function runDiscoveryOnBootSelfHeal(): Promise<void> {
  const [{ backfillDiscoveryAttributionOnBoot }, { reconcilePhantomProductsOnBoot }] = await Promise.all([
    import("@/lib/onboarding/backfill-discovery-attribution-on-boot"),
    import("@/lib/onboarding/reconcile-phantom-products-on-boot"),
  ]);
  await backfillDiscoveryAttributionOnBoot();
  await reconcilePhantomProductsOnBoot();
}
