package action

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"
)

const Version = "dpf.edge-action/1"
const maxLifetime = 5 * time.Minute
const maxClockSkew = 30 * time.Second

var (
	ErrInvalidEnvelope  = errors.New("invalid action envelope")
	ErrInvalidSignature = errors.New("invalid action signature")
	ErrWrongNode        = errors.New("action is bound to another node")
	ErrNotYetValid      = errors.New("action is not yet valid")
	ErrExpired          = errors.New("action has expired")
	ErrLifetimeTooLong  = errors.New("action lifetime exceeds maximum")
	ErrNonceConsumed    = errors.New("action nonce was already consumed")
)

type Envelope struct {
	Version      string          `json:"version"`
	SigningKeyID string          `json:"signingKeyId"`
	ActionKey    string          `json:"actionKey"`
	NodeID       string          `json:"nodeId"`
	ActionType   string          `json:"actionType"`
	Parameters   json.RawMessage `json:"parameters"`
	Nonce        string          `json:"nonce"`
	IssuedAt     string          `json:"issuedAt"`
	ExpiresAt    string          `json:"expiresAt"`
}

type SignedEnvelope struct {
	Envelope
	Signature string `json:"signature"`
}

func CanonicalEnvelope(envelope Envelope) ([]byte, error) {
	var parameters any
	if len(envelope.Parameters) == 0 || json.Unmarshal(envelope.Parameters, &parameters) != nil {
		return nil, ErrInvalidEnvelope
	}
	return json.Marshal(map[string]any{
		"actionKey": envelope.ActionKey, "actionType": envelope.ActionType,
		"expiresAt": envelope.ExpiresAt, "issuedAt": envelope.IssuedAt,
		"nodeId": envelope.NodeID, "nonce": envelope.Nonce,
		"parameters": parameters, "signingKeyId": envelope.SigningKeyID,
		"version": envelope.Version,
	})
}

func VerifyEnvelope(
	signed SignedEnvelope,
	publicKey ed25519.PublicKey,
	expectedNodeID string,
	now time.Time,
	hasConsumedNonce func(string) bool,
) error {
	if signed.Version != Version || signed.SigningKeyID == "" || signed.ActionKey == "" ||
		signed.NodeID == "" || signed.ActionType == "" || signed.Nonce == "" ||
		signed.IssuedAt == "" || signed.ExpiresAt == "" || signed.Signature == "" {
		return ErrInvalidEnvelope
	}
	canonical, err := CanonicalEnvelope(signed.Envelope)
	if err != nil {
		return err
	}
	signature, err := base64.RawURLEncoding.DecodeString(signed.Signature)
	if err != nil || !ed25519.Verify(publicKey, canonical, signature) {
		return ErrInvalidSignature
	}
	if signed.NodeID != expectedNodeID {
		return ErrWrongNode
	}

	issuedAt, err := time.Parse(time.RFC3339Nano, signed.IssuedAt)
	if err != nil {
		return ErrInvalidEnvelope
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, signed.ExpiresAt)
	if err != nil || !expiresAt.After(issuedAt) {
		return ErrInvalidEnvelope
	}
	if expiresAt.Sub(issuedAt) > maxLifetime {
		return ErrLifetimeTooLong
	}
	if issuedAt.After(now.Add(maxClockSkew)) {
		return ErrNotYetValid
	}
	if !expiresAt.After(now) {
		return ErrExpired
	}
	if hasConsumedNonce != nil && hasConsumedNonce(signed.Nonce) {
		return ErrNonceConsumed
	}
	return nil
}
