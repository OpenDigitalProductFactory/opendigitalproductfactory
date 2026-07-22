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
}

// Execute verifies authority, node binding, time bounds, schema, and replay
// state before crossing into host-owned collection code. The nonce is durably
// consumed before execution so a crash cannot cause the host action to run a
// second time after redelivery.
func (e *Executor) Execute(ctx context.Context, signed SignedEnvelope) (map[string]any, error) {
	now := time.Now().UTC()
	if e.Now != nil {
		now = e.Now().UTC()
	}
	if e.Journal == nil || len(e.PublicKey) != ed25519.PublicKeySize || e.NodeID == "" {
		return nil, ErrInvalidEnvelope
	}
	if err := VerifyEnvelope(signed, e.PublicKey, e.NodeID, now, func(nonce string) bool {
		return e.Journal.Has(nonce, now)
	}); err != nil {
		return nil, err
	}
	if signed.ActionType != "inventory.collect" || e.CollectInventory == nil {
		return nil, ErrUnsupportedAction
	}
	var parameters map[string]any
	if err := json.Unmarshal(signed.Parameters, &parameters); err != nil || parameters == nil || len(parameters) != 0 {
		return nil, ErrInvalidParameters
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, signed.ExpiresAt)
	if err != nil {
		return nil, ErrInvalidEnvelope
	}
	if err := e.Journal.Consume(signed.Nonce, expiresAt, now); err != nil {
		return nil, err
	}
	evidence, err := e.CollectInventory(ctx)
	if err != nil {
		return nil, err
	}
	if evidence == nil {
		evidence = map[string]any{}
	}
	evidence["actionType"] = signed.ActionType
	evidence["executionSource"] = "native-edge"
	evidence["executedAt"] = now.Format(time.RFC3339Nano)
	return evidence, nil
}
