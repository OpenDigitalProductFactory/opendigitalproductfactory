package action

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrUnsupportedAction = errors.New("action type is not supported by the native Edge agent")
	ErrInvalidParameters = errors.New("action parameters do not match the allowlisted schema")
)

type Executor struct {
	NodeID           string
	PublicKey        ed25519.PublicKey
	Journal          *ReplayJournal
	Now              func() time.Time
	CollectInventory func(context.Context) (map[string]any, error)
	OrganizationJoin *OrganizationJoinHandler
}

type ExecutionOutput struct {
	Result   map[string]any
	Evidence map[string]any
}

// Execute verifies authority, node binding, time bounds, schema, and replay
// state before crossing into host-owned collection code. The nonce is durably
// consumed before execution so a crash cannot cause the host action to run a
// second time after redelivery.
func (e *Executor) Execute(ctx context.Context, signed SignedEnvelope) (ExecutionOutput, error) {
	now := time.Now().UTC()
	if e.Now != nil {
		now = e.Now().UTC()
	}
	if e.Journal == nil || len(e.PublicKey) != ed25519.PublicKeySize || e.NodeID == "" {
		return ExecutionOutput{}, ErrInvalidEnvelope
	}
	if err := VerifyEnvelope(signed, e.PublicKey, e.NodeID, now, func(nonce string) bool {
		return e.Journal.Has(nonce, now)
	}); err != nil {
		return ExecutionOutput{}, err
	}
	if signed.ActionType == "inventory.collect" {
		if e.CollectInventory == nil {
			return ExecutionOutput{}, ErrUnsupportedAction
		}
		var parameters map[string]any
		if err := json.Unmarshal(signed.Parameters, &parameters); err != nil || parameters == nil || len(parameters) != 0 {
			return ExecutionOutput{}, ErrInvalidParameters
		}
	} else if signed.ActionType != "organization.join.issue" && signed.ActionType != "organization.join.import" {
		return ExecutionOutput{}, ErrUnsupportedAction
	} else if e.OrganizationJoin == nil {
		return ExecutionOutput{}, ErrUnsupportedAction
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, signed.ExpiresAt)
	if err != nil {
		return ExecutionOutput{}, ErrInvalidEnvelope
	}
	if err := e.Journal.Consume(signed.Nonce, expiresAt, now); err != nil {
		return ExecutionOutput{}, err
	}
	var output ExecutionOutput
	if signed.ActionType == "inventory.collect" {
		evidence, err := e.CollectInventory(ctx)
		if err != nil {
			return ExecutionOutput{}, err
		}
		output.Evidence = evidence
	} else {
		var err error
		output, err = e.OrganizationJoin.Execute(ctx, signed.ActionType, signed.Parameters)
		if err != nil {
			return ExecutionOutput{}, err
		}
	}
	if output.Evidence == nil {
		output.Evidence = map[string]any{}
	}
	output.Evidence["actionType"] = signed.ActionType
	output.Evidence["executionSource"] = "native-edge"
	output.Evidence["executedAt"] = now.Format(time.RFC3339Nano)
	return output, nil
}
