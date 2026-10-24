package actionrunner

import (
	"context"
	"errors"
	"fmt"

	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/action"
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/api"
)

type Client interface {
	ClaimActions(context.Context, string, int) ([]action.SignedEnvelope, error)
	ReportAction(context.Context, string, api.ActionResultRequest) error
}

type Executor interface {
	Execute(context.Context, action.SignedEnvelope) (action.ExecutionOutput, error)
}

type Runner struct {
	Client    Client
	Executor  Executor
	NodeToken string
	BatchSize int
	// Pending keeps terminal reports the portal could not take; nil keeps the
	// legacy behaviour of returning the delivery error.
	Pending PendingReports
}

// deliverPending sends kept terminal reports before anything new is claimed.
func (r *Runner) deliverPending(ctx context.Context) error {
	if r.Pending == nil {
		return nil
	}
	reports, err := r.Pending.Load()
	if err != nil {
		return fmt.Errorf("load pending action reports: %w", err)
	}
	for _, report := range reports {
		if err := r.Client.ReportAction(ctx, r.NodeToken, report); err != nil && !refusedForGood(err) {
			return fmt.Errorf("deliver pending report for %s: %w", report.ActionKey, err)
		}
		if err := r.Pending.Remove(report.ActionKey); err != nil {
			return fmt.Errorf("clear pending report for %s: %w", report.ActionKey, err)
		}
	}
	return nil
}

func (r *Runner) RunOnce(ctx context.Context) error {
	batchSize := r.BatchSize
	if batchSize <= 0 || batchSize > 10 {
		batchSize = 1
	}
	if err := r.deliverPending(ctx); err != nil {
		return err
	}
	claimed, err := r.Client.ClaimActions(ctx, r.NodeToken, batchSize)
	if err != nil {
		return err
	}
	for _, envelope := range claimed {
		if err := r.Client.ReportAction(ctx, r.NodeToken, api.ActionResultRequest{
			ActionKey: envelope.ActionKey,
			Outcome:   "running",
			Evidence:  map[string]any{"executionSource": "native-edge"},
		}); err != nil {
			return fmt.Errorf("report action running: %w", err)
		}
		output, executionErr := r.Executor.Execute(ctx, envelope)
		outcome := "succeeded"
		if executionErr != nil {
			outcome = "failed"
			// Keep what the handler recorded (a host procedure's steps), with
			// the sanitized code on top; never the raw error text.
			evidence := map[string]any{}
			for key, value := range output.Evidence {
				evidence[key] = value
			}
			evidence["executionSource"] = "native-edge"
			evidence["errorCode"] = safeErrorCode(executionErr)
			output = action.ExecutionOutput{Evidence: evidence}
		}
		report := api.ActionResultRequest{
			ActionKey: envelope.ActionKey,
			Outcome:   outcome,
			Evidence:  output.Evidence,
			Result:    output.Result,
		}
		if err := r.Client.ReportAction(ctx, r.NodeToken, report); err != nil {
			if r.Pending != nil && !refusedForGood(err) {
				if saveErr := r.Pending.Save(report); saveErr != nil {
					return fmt.Errorf("report action %s: %w (and could not keep it: %v)", outcome, err, saveErr)
				}
				return fmt.Errorf("report action %s kept for redelivery: %w", outcome, err)
			}
			return fmt.Errorf("report action %s: %w", outcome, err)
		}
	}
	return nil
}

func safeErrorCode(err error) string {
	switch {
	case errors.Is(err, action.ErrInvalidSignature):
		return "invalid_signature"
	case errors.Is(err, action.ErrWrongNode):
		return "wrong_node"
	case errors.Is(err, action.ErrExpired):
		return "expired"
	case errors.Is(err, action.ErrNonceConsumed):
		return "nonce_consumed"
	case errors.Is(err, action.ErrUnsupportedAction):
		return "unsupported_action"
	case errors.Is(err, action.ErrInvalidParameters):
		return "invalid_parameters"
	case errors.Is(err, action.ErrWrongOrganizationTrustRole):
		return "wrong_organization_trust_role"
	case errors.Is(err, action.ErrHealthVerificationFailed):
		return "health_verification_failed"
	case errors.Is(err, action.ErrHostActionFailed):
		return "host_action_failed"
	case errors.Is(err, action.ErrRollbackFailed):
		return "rollback_failed"
	case errors.Is(err, action.ErrVmShutdownFailed):
		return "vm_shutdown_failed"
	case errors.Is(err, action.ErrDockerStartFailed):
		return "docker_start_failed"
	case errors.Is(err, action.ErrDockerNotReady):
		return "docker_not_ready"
	case errors.Is(err, action.ErrHostCommandNotAllowed):
		return "host_command_not_allowed"
	default:
		return "execution_failed"
	}
}
