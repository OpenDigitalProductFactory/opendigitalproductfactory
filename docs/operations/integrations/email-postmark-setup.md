# Postmark setup (outbound + inbound)

Phase 3 of the marketing execution loop uses Postmark for transactional outbound + an inbound webhook for replies. DPF is a conduit — you bring your own Postmark account; DPF stores the server token and signing secret encrypted with `CREDENTIAL_ENCRYPTION_KEY` and never proxies through a DPF-owned account.

## One-time setup

1. Create a Postmark account at https://postmarkapp.com. The free dev sandbox is enough for verification.
2. Create a **Server** in the Postmark dashboard. The default Outbound + Inbound streams are sufficient.
3. Verify a **Sender Signature** for your From address (Sender Signatures → Add Domain or single sender). Postmark won't deliver outbound from an unverified address.
4. Under your Server, copy the **Server API Token** from the **API Tokens** tab.
5. Under your Server, configure the **Inbound webhook URL** as shown on `/platform/tools/integrations/email-postmark` (defaults to `${AUTH_URL}/api/integrations/email-postmark/inbound`).
6. Copy the **Inbound webhook signing secret** (Server → Inbound → Webhook signing secret). Set it as the verification secret in DPF — without it, DPF rejects every inbound POST with 401.
7. In DPF, go to **Platform → Tools → Enterprise Integrations → Email (Postmark)** and paste the four values (server token, signing secret, From, optional Reply-To). Click **Save**.

## What this enables

- The marketing approval queue's "Ready to publish" section grows a **Send email** button for approved email drafts.
- Inbound replies hit DPF's webhook, get verified with HMAC-SHA256, get classified (qualified-inquiry / support / spam / other), and qualified inquiries get a holding-pattern reply drafted and queued for your approval.
- Qualified inquiries from senders with an existing `CustomerContact` row are linked to the CRM `Engagement` model with `source=marketing-inbound`.

## Verifying without live email

Set `EMAIL_MOCK_MODE=1` in the install env to make the adapter return a synthetic Postmark message id without calling the API. The verification flow lands in `OutboundPublication` exactly as the real path does. Don't ship this in production — it skips deliverability checks.

## Failure modes

- **`postmark_invalid_server_token` (401):** server token rotated or revoked. Re-paste the new value in the connect form.
- **`postmark_invalid_payload` (422):** From/To/Subject malformed, or From address isn't verified in Postmark. Re-check Sender Signatures.
- **`postmark_rate_limited` (429):** Postmark's per-server send rate. Wait or upgrade the Postmark plan.
- **`invalid_signature` (401 on inbound webhook):** the stored signing secret doesn't match Postmark's current secret. Re-paste it from Server → Inbound.
- **`credential_not_connected`:** no `IntegrationCredential` row with `status=connected`. Complete the connect flow first.

## Rotation

To rotate either secret: paste the new value(s) in the connect form. There's no in-place rotation — the upsert overwrites both encrypted blobs. After the operator rotates a secret in Postmark, any in-flight inbound POSTs with the old signature fail with 401 (Postmark retries; we accept the next valid one).
