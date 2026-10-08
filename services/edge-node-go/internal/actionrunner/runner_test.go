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

// BI-F8F8C383: a Docker VM restart takes the portal down, so its terminal
// report always meets an unreachable portal. It must be kept and delivered.
type flakyClient struct {
	fakeClient
	terminalErr error
}

func (f *flakyClient) ReportAction(ctx context.Context, token string, req api.ActionResultRequest) error {
	if err := f.fakeClient.ReportAction(ctx, token, req); err != nil {
		return err
	}
	if req.Outcome != "running" && f.terminalErr != nil {
		return f.terminalErr
	}
	return nil
}

func TestATerminalReportThePortalCannotTakeIsKeptAndDeliveredBeforeTheNextClaim(t *testing.T) {
	store := FilePendingReports{Dir: t.TempDir()}
	client := &flakyClient{
		fakeClient:  fakeClient{claimed: []action.SignedEnvelope{{Envelope: action.Envelope{ActionKey: "RA-VM-1"}}}},
		terminalErr: errors.New("connection refused"),
	}
	runner := Runner{Client: client, Executor: &fakeExecutor{}, NodeToken: "token", BatchSize: 1, Pending: store}
	if err := runner.RunOnce(context.Background()); err == nil {
		t.Fatal("expected the delivery failure to surface")
	}
	kept, err := store.Load()
	if err != nil || len(kept) != 1 || kept[0].Outcome != "succeeded" {
		t.Fatalf("kept=%#v err=%v", kept, err)
	}

	// The portal is back: the kept report goes first, then normal claiming.
	client.terminalErr = nil
	client.claimed = nil
	client.reports = nil
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(client.reports) != 1 || client.reports[0].ActionKey != "RA-VM-1" || client.reports[0].Outcome != "succeeded" {
		t.Fatalf("redelivered=%#v", client.reports)
	}
	if left, _ := store.Load(); len(left) != 0 {
		t.Fatalf("report not cleared after delivery: %#v", left)
	}
}

func TestAKeptReportThePortalRefusesForGoodIsDropped(t *testing.T) {
	store := FilePendingReports{Dir: t.TempDir()}
	if err := store.Save(api.ActionResultRequest{ActionKey: "RA-OLD", Outcome: "succeeded"}); err != nil {
		t.Fatal(err)
	}
	client := &flakyClient{terminalErr: &api.HTTPError{Status: 409, ErrorCode: "illegal-transition"}}
	runner := Runner{Client: client, Executor: &fakeExecutor{}, NodeToken: "token", BatchSize: 1, Pending: store}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if left, _ := store.Load(); len(left) != 0 {
		t.Fatalf("a refused report must not be retried forever: %#v", left)
	}
}

func TestAFailedHostProcedureKeepsItsStepsWithTheSanitizedCode(t *testing.T) {
	client := &fakeClient{claimed: []action.SignedEnvelope{{Envelope: action.Envelope{ActionKey: "RA-VM-2"}}}}
	executor := &fakeExecutor{err: action.ErrDockerNotReady}
	runner := Runner{Client: client, Executor: executor, NodeToken: "token", BatchSize: 1}
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	failed := client.reports[1]
	if failed.Evidence["errorCode"] != "docker_not_ready" || failed.Evidence["items"] != 2 {
		t.Fatalf("evidence=%#v", failed.Evidence)
	}
}
