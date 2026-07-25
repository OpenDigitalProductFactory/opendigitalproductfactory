package actionrunner

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/action"
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/api"
)

type fakeClient struct {
	claimed    []action.SignedEnvelope
	reports    []api.ActionResultRequest
	runningErr error
}

func (f *fakeClient) ClaimActions(context.Context, string, int) ([]action.SignedEnvelope, error) {
	return f.claimed, nil
}
func (f *fakeClient) ReportAction(_ context.Context, _ string, req api.ActionResultRequest) error {
	f.reports = append(f.reports, req)
	if req.Outcome == "running" {
		return f.runningErr
	}
	return nil
}

type fakeExecutor struct {
	calls int
	err   error
}

func (f *fakeExecutor) Execute(context.Context, action.SignedEnvelope) (action.ExecutionOutput, error) {
	f.calls++
	return action.ExecutionOutput{Evidence: map[string]any{"items": 2}}, f.err
}

func TestRunOnceReportsRunningThenTerminalEvidence(t *testing.T) {
	client := &fakeClient{claimed: []action.SignedEnvelope{{Envelope: action.Envelope{ActionKey: "RA-1", Parameters: json.RawMessage(`{}`)}}}}
	executor := &fakeExecutor{}
	runner := Runner{Client: client, Executor: executor, NodeToken: "token", BatchSize: 1}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if executor.calls != 1 || len(client.reports) != 2 || client.reports[0].Outcome != "running" || client.reports[1].Outcome != "succeeded" {
		t.Fatalf("calls=%d reports=%#v", executor.calls, client.reports)
	}
}

func TestRunOnceDoesNotExecuteWithoutRunningAttribution(t *testing.T) {
	client := &fakeClient{claimed: []action.SignedEnvelope{{Envelope: action.Envelope{ActionKey: "RA-1"}}}, runningErr: errors.New("offline")}
	executor := &fakeExecutor{}
	runner := Runner{Client: client, Executor: executor, NodeToken: "token", BatchSize: 1}
	if err := runner.RunOnce(context.Background()); err == nil {
		t.Fatal("expected report failure")
	}
	if executor.calls != 0 {
		t.Fatalf("executed without running attribution")
	}
}

func TestRunOnceReportsSanitizedFailureCode(t *testing.T) {
	client := &fakeClient{claimed: []action.SignedEnvelope{{Envelope: action.Envelope{ActionKey: "RA-1"}}}}
	executor := &fakeExecutor{err: action.ErrInvalidSignature}
	runner := Runner{Client: client, Executor: executor, NodeToken: "token", BatchSize: 1}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	failed := client.reports[1]
	if failed.Outcome != "failed" || failed.Evidence["errorCode"] != "invalid_signature" {
		t.Fatalf("unexpected failed evidence %#v", failed)
	}
}
