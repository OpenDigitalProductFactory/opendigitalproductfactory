package api

import (
	"context"

	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/action"
)

type actionClaimResponse struct {
	Claimed []action.SignedEnvelope `json:"claimed"`
}

// ActionResultRequest reports one attributable execution transition. Evidence
// is deliberately structured data so the native agent never has to send raw
// command output or secrets back to the Authority.
type ActionResultRequest struct {
	ActionKey string         `json:"actionKey"`
	Outcome   string         `json:"outcome"`
	Evidence  map[string]any `json:"evidence,omitempty"`
}

// ClaimActions polls the machine-authenticated action endpoint. The HTTP
// transport supplies the client certificate; nodeToken remains the second,
// independently scoped bearer factor.
func (c *Client) ClaimActions(ctx context.Context, nodeToken string, limit int) ([]action.SignedEnvelope, error) {
	var resp actionClaimResponse
	if err := c.post(ctx, "/api/v1/edge/actions/claim", nodeToken, map[string]int{"limit": limit}, &resp); err != nil {
		return nil, err
	}
	return resp.Claimed, nil
}

// ReportAction records running or terminal evidence for a claimed action.
func (c *Client) ReportAction(ctx context.Context, nodeToken string, req ActionResultRequest) error {
	return c.post(ctx, "/api/v1/edge/actions/result", nodeToken, req, nil)
}

// RegisterActionCertificate binds the certificate already verified by the
// mTLS proxy to the bearer-authenticated Edge node. No certificate or private
// key travels in the JSON body.
func (c *Client) RegisterActionCertificate(ctx context.Context, nodeToken string) error {
	return c.post(ctx, "/api/v1/edge/actions/certificates/register", nodeToken, struct{}{}, nil)
}
