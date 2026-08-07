-- IEEE OUI registry: resolve a burned-in MAC to its manufacturer. (BI-9632B15B)
--
-- Reference data, not estate data: global, unscoped, seeded from
-- packages/db/data/oui.tsv and never written by discovery.
--
-- Why it exists: nothing in the platform resolved a MAC to a vendor. Every vendor
-- that appeared came from the UniFi controller's OWN lookup, supplied per-client in
-- its API response — so anything the controller did not describe stayed
-- unidentified, including all six UniFi devices themselves (the device endpoint
-- returns no vendor field). That was 12 of the 22 quality rows left after
-- BI-A3D12F85, each asking an operator to name hardware whose MAC states the
-- manufacturer outright.
--
-- Additive and non-destructive: creates one table, touches nothing existing.
-- Empty until `pnpm --filter @dpf/db seed` loads the registry, and an empty table
-- degrades to today's behaviour (no vendor resolved) rather than to an error.
CREATE TABLE "MacVendorOui" (
    -- Upper-case 24-bit prefix, no separators (e.g. 'AC8BA9').
    "oui" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacVendorOui_pkey" PRIMARY KEY ("oui")
);

-- Supports "which prefixes belong to this manufacturer" without scanning ~39k rows.
CREATE INDEX "MacVendorOui_vendor_idx" ON "MacVendorOui"("vendor");
