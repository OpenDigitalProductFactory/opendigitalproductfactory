// EP-ZERO-CONFIG-FEDERATION — boot-time and cadence reconciliation of the
// durable federation state. Order matters:
//   1. identity  — the file wins; the database row is corrected to match.
//   2. absorb    — ledger links the database does not hold are recreated.
//   3. supersede — one link per same-organization peer.
//   4. ledger    — the ledger is rewritten from the (now-correct) database.
// Every step is fault-isolated: a failure is logged and the next step runs.

import { prisma } from "@dpf/db";

import { getErrorMessage } from "@/lib/shared/get-error-message";

import { persistFederationIdentityDurably, type FederationIdentityDb } from "./demand-identity";
import { defaultFederationStore, type DurableFederationStore } from "./durable-state";
import { supersedeStaleSameOrgLinks, type SupersessionDb } from "./link-supersession";
import { absorbPeerLedgerIntoDb, syncPeerLedgerFromDb, type PeerLedgerDb } from "./peer-ledger";

export interface FederationReconcileResult {
  identity: "durable" | "database-only" | "failed";
  absorbed: string[];
  superseded: Array<{ linkId: string; supersededBy: string }>;
  ledgerWritten: boolean;
  ledgerLinks: number;
}

export async function reconcileFederationDurableStateOnBoot(
  db: FederationIdentityDb & PeerLedgerDb & SupersessionDb = prisma as never,
  store: DurableFederationStore = defaultFederationStore(),
): Promise<FederationReconcileResult> {
  const result: FederationReconcileResult = {
    identity: "failed", absorbed: [], superseded: [], ledgerWritten: false, ledgerLinks: 0,
  };
  try {
    result.identity = await persistFederationIdentityDurably(db, { store });
  } catch (error) {
    console.error(`[federation] identity reconcile failed: ${getErrorMessage(error)}`);
  }
  try {
    const absorbed = await absorbPeerLedgerIntoDb(db, { store });
    result.absorbed = absorbed.absorbed;
    if (absorbed.absorbed.length > 0) {
      console.log(`[federation] absorbed ${absorbed.absorbed.length} link(s) from the peer ledger: ${absorbed.absorbed.join(", ")}`);
    }
  } catch (error) {
    console.error(`[federation] ledger absorb failed: ${getErrorMessage(error)}`);
  }
  const links = await reconcileFederationLinks(db, store);
  result.superseded = links.superseded;
  result.ledgerWritten = links.ledgerWritten;
  result.ledgerLinks = links.ledgerLinks;
  console.log(`[federation] durable state: identity=${result.identity} ledger=${result.ledgerWritten ? result.ledgerLinks + " link(s)" : "not written"}`);
  return result;
}

/** Cadence half (no identity/absorb): supersede, then rewrite the ledger. */
export async function reconcileFederationLinks(
  db: PeerLedgerDb & SupersessionDb = prisma as never,
  store: DurableFederationStore = defaultFederationStore(),
): Promise<Pick<FederationReconcileResult, "superseded" | "ledgerWritten" | "ledgerLinks">> {
  let superseded: Array<{ linkId: string; supersededBy: string }> = [];
  try {
    superseded = (await supersedeStaleSameOrgLinks(db)).revoked;
  } catch (error) {
    console.error(`[federation] supersession failed: ${getErrorMessage(error)}`);
  }
  let ledgerWritten = false;
  let ledgerLinks = 0;
  try {
    const sync = await syncPeerLedgerFromDb(db, { store });
    ledgerWritten = sync.written;
    ledgerLinks = sync.links;
  } catch (error) {
    console.error(`[federation] ledger sync failed: ${getErrorMessage(error)}`);
  }
  return { superseded, ledgerWritten, ledgerLinks };
}
