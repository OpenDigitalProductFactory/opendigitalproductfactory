package envelope

import (
	"encoding/json"
	"strings"
	"testing"
)

func validEvent() Event {
	return Event{
		DedupKey:   "snmp.trap:10.0.0.5:ifaceDown:ifIndex=42",
		Source:     "snmp.trap",
		Component:  "10.0.0.5",
		EventGroup: "network",
		EventClass: "interface_down",
		Severity:   SeverityError,
		Action:     ActionTrigger,
		Summary:    "Interface ifIndex=42 link state down on 10.0.0.5",
		OccurredAt: "2026-05-21T02:30:00Z",
		CustomDetails: map[string]any{
			"ifIndex":    42,
			"ifDescr":    "GigabitEthernet0/1",
			"trapSource": "10.0.0.5",
		},
	}
}

func validEnvelope() Envelope {
	return Envelope{
		RunKey:        "1a2b3c4d-5e6f-4a7b-8c9d-eeff00112233",
		NodeID:        "edge-node-test",
		ObservedAt:    "2026-05-21T02:30:01Z",
		EventsVersion: EnvelopeVersion,
		Events:        []Event{validEvent()},
	}
}

func TestEvent_Validate_HappyPath(t *testing.T) {
	if err := validEvent().Validate(); err != nil {
		t.Fatalf("valid event rejected: %v", err)
	}
}

func TestEvent_Validate_MissingRequired(t *testing.T) {
	cases := []struct {
		name string
		mut  func(*Event)
		want string
	}{
		{"no dedupKey", func(e *Event) { e.DedupKey = "" }, "dedupKey"},
		{"no source", func(e *Event) { e.Source = "" }, "source"},
		{"no summary", func(e *Event) { e.Summary = "" }, "summary"},
		{"bad severity", func(e *Event) { e.Severity = "panic" }, "severity"},
		{"bad action", func(e *Event) { e.Action = "page" }, "action"},
		{"bad occurredAt", func(e *Event) { e.OccurredAt = "yesterday" }, "occurredAt"},
		// Slice 1 (BI-8405FDA5): eventType enum validation.
		{"bad eventType", func(e *Event) { e.EventType = "incident" }, "eventType"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := validEvent()
			tc.mut(&e)
			err := e.Validate()
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.want)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error %q does not mention %q", err, tc.want)
			}
		})
	}
}

// Slice 1 (BI-8405FDA5): EventType acceptance matrix. Empty must accept
// (Slice 0 wire compatibility); explicit alert + change must accept.
func TestEvent_Validate_EventTypeAccepted(t *testing.T) {
	cases := []EventType{"", EventTypeAlert, EventTypeChange}
	for _, et := range cases {
		t.Run(string(et), func(t *testing.T) {
			e := validEvent()
			e.EventType = et
			if err := e.Validate(); err != nil {
				t.Fatalf("eventType %q rejected: %v", et, err)
			}
		})
	}
}

// JSON tag for EventType uses omitempty so Slice 0 producers omitting the
// field don't add a noisy "eventType":"" pair on the wire. Verify both
// directions: explicit type round-trips; omitted type produces no key.
func TestEvent_EventType_JSONOmitempty(t *testing.T) {
	withType := validEvent()
	withType.EventType = EventTypeChange
	raw, _ := json.Marshal(withType)
	if !strings.Contains(string(raw), `"eventType":"change"`) {
		t.Fatalf("explicit eventType missing from JSON: %s", raw)
	}

	withoutType := validEvent()
	raw2, _ := json.Marshal(withoutType)
	if strings.Contains(string(raw2), `"eventType"`) {
		t.Fatalf("omitted eventType leaked into JSON: %s", raw2)
	}
}

func TestEvent_Validate_TooLong(t *testing.T) {
	e := validEvent()
	e.DedupKey = strings.Repeat("x", 256)
	if err := e.Validate(); err == nil || !strings.Contains(err.Error(), "dedupKey") {
		t.Fatalf("expected dedupKey length error, got %v", err)
	}
	e = validEvent()
	e.Summary = strings.Repeat("y", 501)
	if err := e.Validate(); err == nil || !strings.Contains(err.Error(), "summary") {
		t.Fatalf("expected summary length error, got %v", err)
	}
}

func TestEnvelope_Validate_HappyPath(t *testing.T) {
	if err := validEnvelope().Validate(); err != nil {
		t.Fatalf("valid envelope rejected: %v", err)
	}
}

func TestEnvelope_Validate_BadVersion(t *testing.T) {
	env := validEnvelope()
	env.EventsVersion = "0"
	if err := env.Validate(); err == nil || !strings.Contains(err.Error(), "eventsVersion") {
		t.Fatalf("expected eventsVersion error, got %v", err)
	}
}

func TestEnvelope_Validate_EmptyEvents(t *testing.T) {
	env := validEnvelope()
	env.Events = nil
	if err := env.Validate(); err == nil || !strings.Contains(err.Error(), "events") {
		t.Fatalf("expected empty events error, got %v", err)
	}
}

func TestEnvelope_Validate_BatchTooLarge(t *testing.T) {
	env := validEnvelope()
	env.Events = make([]Event, MaxEventsPerBatch+1)
	for i := range env.Events {
		env.Events[i] = validEvent()
	}
	if err := env.Validate(); err == nil || !strings.Contains(err.Error(), "max batch size") {
		t.Fatalf("expected batch size error, got %v", err)
	}
}

func TestEnvelope_Validate_PropagatesEventIndex(t *testing.T) {
	env := validEnvelope()
	bad := validEvent()
	bad.Severity = "fatal"
	env.Events = []Event{validEvent(), bad}
	err := env.Validate()
	if err == nil {
		t.Fatal("expected error for invalid event[1]")
	}
	if !strings.Contains(err.Error(), "events[1]") {
		t.Fatalf("error should include event index, got %q", err)
	}
}

// TestEnvelope_JSON_RoundTrip is the canonical sanity check that the
// json tags match the Zod schema's field names — drift here will also
// surface in the cross-runtime wire-contract parity test, but failing
// fast in the Go test loop is cheaper.
func TestEnvelope_JSON_RoundTrip(t *testing.T) {
	env := validEnvelope()
	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	keys := []string{
		`"runKey"`,
		`"nodeId"`,
		`"observedAt"`,
		`"eventsVersion"`,
		`"events"`,
		`"dedupKey"`,
		`"source"`,
		`"component"`,
		`"eventGroup"`,
		`"eventClass"`,
		`"severity"`,
		`"action"`,
		`"summary"`,
		`"occurredAt"`,
		`"customDetails"`,
	}
	for _, k := range keys {
		if !strings.Contains(string(raw), k) {
			t.Fatalf("serialized envelope missing key %s: %s", k, raw)
		}
	}
}
