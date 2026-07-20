// Package api carries the wire-contract types that mirror the Authority
// Core's /api/v1/edge/* request and response shapes. The contract is the
// seam between Mode 1 (TypeScript container, services/edge-node) and
// Mode 4 (Go native, this package) — wire-contract parity tests on the
// Authority side keep both runtimes honest.
//
// Source of truth for the contract is the Zod schemas at:
//
//	apps/web/app/api/v1/edge/{enroll,heartbeat,discovery-runs,metrics}/route.ts
//
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

// SubmissionEnvelope mirrors the shape services/edge-node/src/sweep.ts
// builds for POST /api/v1/edge/discovery-runs. The Authority side
// (apps/web/app/api/v1/edge/discovery-runs/route.ts) validates this
// shape with its own Zod schema — wire-contract parity tests on the
// Authority side replay captured fixtures from both runtimes against
// that schema.
//
// items + relationships are typed as `any` here because the collect
// package owns the concrete shapes (collect.Item, collect.Relationship)
// and we don't want to create an import cycle. The Authority's Zod
// validates each item separately.
type SubmissionEnvelope struct {
	RunKey        string   `json:"runKey"`
	AgentMode     string   `json:"agentMode"`
	AgentVersion  string   `json:"agentVersion"`
	ObservedAt    string   `json:"observedAt"` // RFC 3339
	Capabilities  []string `json:"capabilities"`
	Items         []any    `json:"items"`
	Relationships []any    `json:"relationships"`
	Warnings      []string `json:"warnings,omitempty"`
}

// FederationCandidateSnapshot is the privacy-bounded nearby-installation
// report sent by a trusted native Edge Node. Candidate is kept as `any` here
// to avoid an api↔federation package cycle; the Authority validates every
// member against its closed Zod contract.
type FederationCandidateSnapshot struct {
	ObservedAt string `json:"observedAt"`
	Candidates []any  `json:"candidates"`
}
