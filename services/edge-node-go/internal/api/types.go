// Package api carries the wire-contract types that mirror the Authority
// Core's /api/v1/edge/* request and response shapes. The contract is the
// seam between Mode 1 (TypeScript container, services/edge-node) and
// Mode 4 (Go native, this package) — wire-contract parity tests on the
// Authority side keep both runtimes honest.
//
// Source of truth for the contract is the Zod schemas at:
//   apps/web/app/api/v1/edge/{enroll,heartbeat,discovery-runs,metrics}/route.ts
// and the TypeScript client at services/edge-node/src/api-client.ts.
package api

// EnrollRequest mirrors services/edge-node/src/api-client.ts EnrollRequest.
// Field order is the JSON wire order the Authority's Zod schema expects;
// json struct tags preserve it across (un)marshalling.
type EnrollRequest struct {
	DisplayName            string         `json:"displayName"`
	Platform               string         `json:"platform"`
	InstallMode            string         `json:"installMode"`
	Version                string         `json:"version"`
	AdvertisedCapabilities []string       `json:"advertisedCapabilities"`
	HostFingerprint        string         `json:"hostFingerprint,omitempty"`
	Metadata               map[string]any `json:"metadata,omitempty"`
}

// EnrollResponse mirrors EnrollResponse from the TS client.
type EnrollResponse struct {
	OK                   bool     `json:"ok"`
	NodeID               string   `json:"nodeId"`
	NodeToken            string   `json:"nodeToken"`
	TrustState           string   `json:"trustState"`
	HeartbeatIntervalSec int      `json:"heartbeatIntervalSec"`
	SweepIntervalSec     int      `json:"sweepIntervalSec"`
	MetricsIntervalSec   *int     `json:"metricsIntervalSec,omitempty"`
	AcceptedCapabilities []string `json:"acceptedCapabilities"`
}

// CapabilityReport carries per-capability health back to the Authority.
type CapabilityReport struct {
	Capability string         `json:"capability"`
	Status     string         `json:"status"` // healthy | degraded | failing | unknown
	Evidence   map[string]any `json:"evidence,omitempty"`
}

// HeartbeatRequest mirrors HeartbeatRequest from the TS client.
type HeartbeatRequest struct {
	CapabilityReports []CapabilityReport `json:"capabilityReports,omitempty"`
}

// HeartbeatResponse mirrors HeartbeatResponse from the TS client.
type HeartbeatResponse struct {
	OK                   bool     `json:"ok"`
	HeartbeatIntervalSec int      `json:"heartbeatIntervalSec"`
	SweepIntervalSec     int      `json:"sweepIntervalSec"`
	MetricsIntervalSec   *int     `json:"metricsIntervalSec,omitempty"`
	AcceptedCapabilities []string `json:"acceptedCapabilities"`
	TrustState           string   `json:"trustState"` // pending | trusted | quarantined | revoked
}

// AuthorityErrorBody is the JSON shape the Authority returns for
// non-2xx responses. The 'error' field carries a stable machine-readable
// code (e.g. "node_revoked", "bootstrap_token_consumed"); the optional
// 'message' is operator-facing.
type AuthorityErrorBody struct {
	Error   string `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
}
