package action

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestExecutorRunsAllowlistedInventoryCollectionExactlyOnce(t *testing.T) {
	signed, publicKey := signedFixture(t, func(envelope *Envelope) {
		envelope.Parameters = json.RawMessage(`{}`)
	})
	journal, err := OpenReplayJournal(t.TempDir(), now)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	executor := Executor{
		NodeID: "edge_1", PublicKey: publicKey, Journal: journal,
		Now: func() time.Time { return now },
		CollectInventory: func(context.Context) (map[string]any, error) {
			calls++
			return map[string]any{"items": 3, "source": "native"}, nil
		},
	}

	output, err := executor.Execute(context.Background(), signed)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 || output.Evidence["items"] != 3 {
		t.Fatalf("calls=%d evidence=%#v", calls, output.Evidence)
	}
	if _, err := executor.Execute(context.Background(), signed); !errors.Is(err, ErrNonceConsumed) {
		t.Fatalf("replay returned %v, want ErrNonceConsumed", err)
	}
	if calls != 1 {
		t.Fatalf("replay executed collector; calls=%d", calls)
	}
}

func TestExecutorRejectsUnknownActionAndParametersBeforeConsumption(t *testing.T) {
	for name, mutate := range map[string]func(*Envelope){
		"unknown action":    func(e *Envelope) { e.ActionType = "script.run"; e.Parameters = json.RawMessage(`{}`) },
		"unknown parameter": func(e *Envelope) { e.Parameters = json.RawMessage(`{"command":"whoami"}`) },
	} {
		t.Run(name, func(t *testing.T) {
			signed, publicKey := signedFixture(t, mutate)
			journal, _ := OpenReplayJournal(t.TempDir(), now)
			calls := 0
			executor := Executor{NodeID: "edge_1", PublicKey: publicKey, Journal: journal, Now: func() time.Time { return now }, CollectInventory: func(context.Context) (map[string]any, error) { calls++; return nil, nil }}
			if _, err := executor.Execute(context.Background(), signed); !errors.Is(err, ErrUnsupportedAction) && !errors.Is(err, ErrInvalidParameters) {
				t.Fatalf("got %v", err)
			}
			if calls != 0 || journal.Has(signed.Nonce, now) {
				t.Fatalf("rejected action executed or consumed: calls=%d", calls)
			}
		})
	}
}

type qualificationExecutorStub struct{ calls int }

func (s *qualificationExecutorStub) Execute(_ context.Context, parameters json.RawMessage) (ExecutionOutput, error) {
	s.calls++
	return ExecutionOutput{Evidence: map[string]any{"procedureId": WindowsHandleReplacementProcedureID}}, nil
}

func TestExecutorRunsClosedWindowsQualificationExactlyOnce(t *testing.T) {
	signed, publicKey := signedFixture(t, func(envelope *Envelope) {
		envelope.ActionType = QualificationWindowsVerifyActionType
		envelope.Parameters = qualificationParametersFixture(t)
	})
	journal, err := OpenReplayJournal(t.TempDir(), now)
	if err != nil {
		t.Fatal(err)
	}
	handler := &qualificationExecutorStub{}
	executor := Executor{
		NodeID: "edge_1", PublicKey: publicKey, Journal: journal,
		Now: func() time.Time { return now }, QualificationWindows: handler,
	}
	output, err := executor.Execute(context.Background(), signed)
	if err != nil {
		t.Fatal(err)
	}
	if handler.calls != 1 || output.Evidence["procedureId"] != WindowsHandleReplacementProcedureID {
		t.Fatalf("calls=%d evidence=%#v", handler.calls, output.Evidence)
	}
	if _, err := executor.Execute(context.Background(), signed); !errors.Is(err, ErrNonceConsumed) {
		t.Fatalf("replay returned %v, want ErrNonceConsumed", err)
	}
}

func TestExecutorRejectsWidenedQualificationBeforeNonceConsumption(t *testing.T) {
	signed, publicKey := signedFixture(t, func(envelope *Envelope) {
		envelope.ActionType = QualificationWindowsVerifyActionType
		envelope.Parameters = append(qualificationParametersFixture(t)[:len(qualificationParametersFixture(t))-1], []byte(`,"command":"pwsh"}`)...)
	})
	journal, _ := OpenReplayJournal(t.TempDir(), now)
	handler := &qualificationExecutorStub{}
	executor := Executor{NodeID: "edge_1", PublicKey: publicKey, Journal: journal, Now: func() time.Time { return now }, QualificationWindows: handler}
	if _, err := executor.Execute(context.Background(), signed); !errors.Is(err, ErrInvalidParameters) {
		t.Fatalf("got %v, want ErrInvalidParameters", err)
	}
	if handler.calls != 0 || journal.Has(signed.Nonce, now) {
		t.Fatalf("rejected action executed or consumed: calls=%d", handler.calls)
	}
}
