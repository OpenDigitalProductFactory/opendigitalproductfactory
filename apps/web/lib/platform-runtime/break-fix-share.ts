/**
 * Break-fix share of the rolling week (BI-F2FEC1EB, design 2026-09-02 §4):
 * declared break-fix items closed over all items closed. Above this share the
 * Right Now Governance card flags a finding, not a number.
 *
 * Client-safe on purpose: WorkforceNowShell renders in the browser and must
 * not pull the server-only activity loader (and with it @dpf/db) into its
 * bundle just to read one threshold.
 */
export const BREAK_FIX_SHARE_FINDING_THRESHOLD = 0.2;
