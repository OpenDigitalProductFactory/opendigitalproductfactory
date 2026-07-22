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
}

func (r *Runner) RunOnce(ctx context.Context) error {
	batchSize := r.BatchSize
	if batchSize <= 0 || batchSize > 10 {
		batchSize = 1
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
			output = action.ExecutionOutput{Evidence: map[string]any{
				"executionSource": "native-edge",
				"errorCode":       safeErrorCode(executionErr),
			}}
		}
		if err := r.Client.ReportAction(ctx, r.NodeToken, api.ActionResultRequest{
			ActionKey: envelope.ActionKey,
			Outcome:   outcome,
			Evidence:  output.Evidence,
			Result:    output.Result,
		}); err != nil {
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
	default:
		return "execution_failed"
	}
}
