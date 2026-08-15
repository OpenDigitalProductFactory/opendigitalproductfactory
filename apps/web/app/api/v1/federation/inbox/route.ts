// ActivityPub-style server-to-server inbox. The legacy /demand route remains a
// compatibility alias during rolling upgrades; both enter the same idempotent
// CloudEvent validation and mirror handlers.
export { POST } from "../demand/route";
