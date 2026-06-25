-- EP-MSP-FEDERATION · R4 — outbound peer token at rest. The peer-issued link
-- token WE use to call the peer (encrypted, AES-256-GCM, since we must replay it
-- rather than hash it). Set when this deployment enrolls outbound with a peer.
ALTER TABLE "FederationLink" ADD COLUMN "peerTokenEnc" TEXT;
