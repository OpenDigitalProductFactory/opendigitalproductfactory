// Package envelope defines the canonical wire shape for events emitted by
// edge-side detectors and posted to POST /api/v1/edge/events.
//
// The Go struct here mirrors the Zod schema in
// packages/validators/src/edge.ts (edgeEventEnvelopeSchema). Drift between
// the two is caught by the cross-runtime parity test at
// apps/web/app/api/v1/edge/__tests__/wire-contract.test.ts — keep the
// json tags and field order identical when changing either side.
//
// Slice 0 of the edge-node detection engine (BI-9FE9D48D).
// Spec: docs/superpowers/specs/2026-05-21-edge-event-envelope-design.md
package envelope

import (
	"errors"
	"fmt"
	"time"
)

// EnvelopeVersion is the wire-format version literal. Bumped only when the
// shape changes in a backwards-incompatible way; the portal Zod uses a
// literal type so any drift here surfaces as a 422 invalid_envelope.
const EnvelopeVersion = "1"

// Severity is the PD-CEF severity ordering: info < warn < error < critical.
type Severity string

const (
	SeverityInfo     Severity = "info"
	SeverityWarn     Severity = "warn"
	SeverityError    Severity = "error"
	SeverityCritical Severity = "critical"
)

// Action drives the portal-side lifecycle. trigger opens or re-opens an
// event; acknowledge marks it under investigation; resolve closes it.
// A later trigger on the same dedupKey re-opens the row (resolvedAt
// cleared, occurrenceCount++).
type Action string

const (
	ActionTrigger     Action = "trigger"
	ActionAcknowledge Action = "acknowledge"
	ActionResolve     Action = "resolve"
)

// Event is one detector observation. DedupKey is the only field detectors
// MUST compose carefully — the portal collapses replays on
// (edgeNodeId, dedupKey), so the same condition observed twice must produce
// byte-identical dedupKey strings. Recommended composition:
//
//	source + ":" + component + ":" + eventClass [+ ":" + instance]
//
// e.g. "snmp.trap:10.0.0.5:ifaceDown:ifIndex=42".
type Event struct {
	DedupKey      string         `json:"dedupKey"`
	Source        string         `json:"source"`
	Component     string         `json:"component,omitempty"`
	EventGroup    string         `json:"eventGroup,omitempty"`
	EventClass    string         `json:"eventClass,omitempty"`
	Severity      Severity       `json:"severity"`
	Action        Action         `json:"action"`
	Summary       string         `json:"summary"`
	OccurredAt    string         `json:"occurredAt"` // RFC 3339
	CustomDetails map[string]any `json:"customDetails,omitempty"`
}

// Envelope is the POST /api/v1/edge/events body. RunKey provides
// idempotency at the batch level the same way it does for discovery-runs
// and metrics; NodeID is informational only (the portal trusts the bearer
// token, not the body).
type Envelope struct {
	RunKey        string  `json:"runKey"`
	NodeID        string  `json:"nodeId,omitempty"`
	ObservedAt    string  `json:"observedAt"` // RFC 3339
	EventsVersion string  `json:"eventsVersion"`
	Events        []Event `json:"events"`
}

// MaxEventsPerBatch caps a single submission at 500 events — matches the
// portal's z.array(...).max(500). Detectors that need to flush more should
// split into multiple Envelopes with distinct RunKeys.
const MaxEventsPerBatch = 500

// Validate runs the same shape + enum checks the portal Zod will apply, so
// detectors and the transport layer can fail fast without a round trip.
//
// Validate does NOT check freshness (observedAt within 5 min of "now")
// because that's a portal-side ingestion control and the edge may
// legitimately queue events offline; the portal returns 422 stale_payload
// in that case and the transport retries with a fresh observedAt.
func (e Event) Validate() error {
	if e.DedupKey == "" {
		return errors.New("dedupKey is required")
	}
	if len(e.DedupKey) > 255 {
		return fmt.Errorf("dedupKey exceeds 255 chars: %d", len(e.DedupKey))
	}
	if e.Source == "" {
		return errors.New("source is required")
	}
	if len(e.Source) > 100 {
		return fmt.Errorf("source exceeds 100 chars: %d", len(e.Source))
	}
	if e.Summary == "" {
		return errors.New("summary is required")
	}
	if len(e.Summary) > 500 {
		return fmt.Errorf("summary exceeds 500 chars: %d", len(e.Summary))
	}
	switch e.Severity {
	case SeverityInfo, SeverityWarn, SeverityError, SeverityCritical:
	default:
		return fmt.Errorf("invalid severity %q (want info|warn|error|critical)", e.Severity)
	}
	switch e.Action {
	case ActionTrigger, ActionAcknowledge, ActionResolve:
	default:
		return fmt.Errorf("invalid action %q (want trigger|acknowledge|resolve)", e.Action)
	}
	if _, err := time.Parse(time.RFC3339, e.OccurredAt); err != nil {
		return fmt.Errorf("occurredAt is not RFC 3339: %w", err)
	}
	return nil
}

// Validate the full batch. Returns the first failing event's index for
// debuggability; callers may choose to filter-and-resubmit instead.
func (env Envelope) Validate() error {
	if env.RunKey == "" {
		return errors.New("runKey is required")
	}
	if env.EventsVersion != EnvelopeVersion {
		return fmt.Errorf("eventsVersion must be %q (got %q)", EnvelopeVersion, env.EventsVersion)
	}
	if _, err := time.Parse(time.RFC3339, env.ObservedAt); err != nil {
		return fmt.Errorf("observedAt is not RFC 3339: %w", err)
	}
	if len(env.Events) == 0 {
		return errors.New("events must contain at least one event")
	}
	if len(env.Events) > MaxEventsPerBatch {
		return fmt.Errorf("events exceeds max batch size %d: %d", MaxEventsPerBatch, len(env.Events))
	}
	for i, ev := range env.Events {
		if err := ev.Validate(); err != nil {
			return fmt.Errorf("events[%d]: %w", i, err)
		}
	}
	return nil
}
