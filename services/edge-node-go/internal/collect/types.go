// Package collect houses the host-fact collectors for the Edge Node.
// Each collector produces ObservationItems that get bundled into a
// SubmissionEnvelope and POSTed to /api/v1/edge/discovery-runs.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
// Plan: docs/superpowers/plans/2026-05-14-edge-node-t3-windows-native.md
//   § W2 (host info) — this package
//   § W3 (ARP)        — adds arp.go in a subsequent slice
//   § W4 (SNMP)       — adds snmp.go in a subsequent slice
package collect

// Item mirrors the TypeScript ObservationItem shape from
// services/edge-node/src/collectors/host-info.ts. Field names + JSON
// tags are kept identical so either runtime can produce a submission
// envelope the Authority's discovery-run Zod schema accepts.
//
// Drift in this struct IS a wire-contract regression — the parity
// test at apps/web/app/api/v1/edge/__tests__/wire-contract.test.ts
// catches it on the CI side.
type Item struct {
	ObservedKey string         `json:"observedKey"`
	ItemType    string         `json:"itemType"`
	Name        string         `json:"name"`
	SourcePath  string         `json:"sourcePath,omitempty"`
	Confidence  float64        `json:"confidence,omitempty"`
	RawData     map[string]any `json:"rawData"`
}

// Relationship mirrors the TS SubmissionRelationship shape. The current
// host-info collector emits zero relationships; ARP (W3) and onward
// will populate this list.
type Relationship struct {
	FromObservedKey  string         `json:"fromObservedKey"`
	ToObservedKey    string         `json:"toObservedKey"`
	RelationshipType string         `json:"relationshipType"`
	RawData          map[string]any `json:"rawData,omitempty"`
}

// Result is what each collector returns. Warnings are non-fatal
// observations the operator should see (couldn't read a file, missing
// capability, etc.) without failing the whole sweep.
type Result struct {
	Items         []Item
	Relationships []Relationship
	Warnings      []string
}
