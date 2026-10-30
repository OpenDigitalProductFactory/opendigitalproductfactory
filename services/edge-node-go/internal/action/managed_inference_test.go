package action

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func managedParameters(t *testing.T, change func(map[string]any)) json.RawMessage {
	t.Helper()
	p := map[string]any{"version": 1, "operation": "activate", "sourceSha": strings.Repeat("a", 40),
		"profileSha256": strings.Repeat("b", 64), "runtimeManifestSha256": strings.Repeat("c", 64),
		"qualificationReportSha256": strings.Repeat("d", 64), "baselineEngineSha256": strings.Repeat("e", 64),
		"leaseId": "NPEL-A123456789"}
	if change != nil {
		change(p)
	}
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

type managedRecorder struct {
	calls    int
	envelope SignedEnvelope
	err      error
}

func (m *managedRecorder) Execute(_ context.Context, envelope SignedEnvelope) (ExecutionOutput, error) {
	m.calls++
	m.envelope = envelope
	return ExecutionOutput{Evidence: map[string]any{"fixture": true}}, m.err
}

func TestManagedInferenceUsesSignedNodeBoundSingleUseEntry(t *testing.T) {
	signed, key := signedFixture(t, func(e *Envelope) {
		e.ActionType = ManagedInferenceActionType
		e.Parameters = managedParameters(t, nil)
	})
	journal, err := OpenReplayJournal(t.TempDir(), now)
	if err != nil {
		t.Fatal(err)
	}
	recorder := &managedRecorder{}
	executor := Executor{NodeID: "edge_1", PublicKey: key, Journal: journal, Now: func() time.Time { return now }, ManagedInference: recorder}
	if _, err := executor.Execute(context.Background(), signed); err != nil {
		t.Fatal(err)
	}
	if recorder.calls != 1 || recorder.envelope.ActionKey != signed.ActionKey || recorder.envelope.Signature != signed.Signature {
		t.Fatal("native handler did not receive the original verified envelope")
	}
	if _, err := executor.Execute(context.Background(), signed); !errors.Is(err, ErrNonceConsumed) {
		t.Fatalf("replay: %v", err)
	}
	if _, err := executor.dispatchPrivileged(context.Background(), ManagedInferenceActionType, signed.Parameters); !errors.Is(err, ErrUnsupportedAction) {
		t.Fatalf("unsigned parameters-only dispatch must not reach this procedure: %v", err)
	}
	if recorder.calls != 1 {
		t.Fatal("native procedure ran twice")
	}
}

func TestManagedInferencePayloadIsClosedAndContainsNoHostCommandOrPath(t *testing.T) {
	for _, operation := range []string{"activate", "rollback"} {
		raw := managedParameters(t, func(p map[string]any) { p["operation"] = operation })
		if _, err := parseManagedInferenceParameters(raw); err != nil {
			t.Fatalf("%s: %v", operation, err)
		}
	}
	for name, change := range map[string]func(map[string]any){
		"shell":   func(p map[string]any) { p["command"] = "whoami" },
		"path":    func(p map[string]any) { p["packagePath"] = "/foreign" },
		"URL":     func(p map[string]any) { p["url"] = "http://foreign.invalid" },
		"port":    func(p map[string]any) { p["port"] = 80 },
		"verb":    func(p map[string]any) { p["operation"] = "restart-anything" },
		"version": func(p map[string]any) { p["version"] = 2 },
		"digest":  func(p map[string]any) { p["profileSha256"] = "../foreign" },
		"source":  func(p map[string]any) { p["sourceSha"] = "main" },
		"lease":   func(p map[string]any) { p["leaseId"] = "" },
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := parseManagedInferenceParameters(managedParameters(t, change)); !errors.Is(err, ErrInvalidParameters) {
				t.Fatalf("got %v", err)
			}
		})
	}
	if _, err := parseManagedInferenceParameters(append(managedParameters(t, nil), []byte(` {}`)...)); !errors.Is(err, ErrInvalidParameters) {
		t.Fatal("accepted a second JSON value")
	}
}

func TestManagedInferenceRefusesMissingHandlerOrInvalidPayloadBeforeNonceConsumption(t *testing.T) {
	for _, invalid := range []bool{false, true} {
		signed, key := signedFixture(t, func(e *Envelope) {
			e.ActionType = ManagedInferenceActionType
			e.Parameters = managedParameters(t, func(p map[string]any) {
				if invalid {
					p["command"] = "anything"
				}
			})
		})
		journal, _ := OpenReplayJournal(t.TempDir(), now)
		recorder := &managedRecorder{}
		executor := Executor{NodeID: "edge_1", PublicKey: key, Journal: journal, Now: func() time.Time { return now }}
		want := ErrUnsupportedAction
		if invalid {
			executor.ManagedInference = recorder
			want = ErrInvalidParameters
		}
		if _, err := executor.Execute(context.Background(), signed); !errors.Is(err, want) {
			t.Fatalf("got %v want %v", err, want)
		}
		if journal.Has(signed.Nonce, now) || recorder.calls != 0 {
			t.Fatal("refusal consumed or executed the native action")
		}
	}
}

func TestManagedInferenceFailureCannotReplayTheConsumedOperation(t *testing.T) {
	signed, key := signedFixture(t, func(e *Envelope) { e.ActionType = ManagedInferenceActionType; e.Parameters = managedParameters(t, nil) })
	journal, _ := OpenReplayJournal(t.TempDir(), now)
	recorder := &managedRecorder{err: errors.New("fixture uncertain effect")}
	executor := Executor{NodeID: "edge_1", PublicKey: key, Journal: journal, Now: func() time.Time { return now }, ManagedInference: recorder}
	output, err := executor.Execute(context.Background(), signed)
	if err == nil || output.Evidence["fixture"] != true {
		t.Fatal("lost native failure evidence")
	}
	if _, err := executor.Execute(context.Background(), signed); !errors.Is(err, ErrNonceConsumed) {
		t.Fatalf("failure replay: %v", err)
	}
	if recorder.calls != 1 {
		t.Fatal("uncertain operation executed again")
	}
}
