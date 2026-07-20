package api

import "context"

// Heartbeat calls POST /api/v1/edge/heartbeat with the node token. The
// returned trustState may flip to "revoked"; main.go and the heartbeat
// loop watch for that and exit cleanly. Per-call cadences (heartbeat,
// sweep, metrics) can change between calls; callers should re-read.
func (c *Client) Heartbeat(ctx context.Context, nodeToken string, req HeartbeatRequest) (*HeartbeatResponse, error) {
	var resp HeartbeatResponse
	if err := c.post(ctx, "/api/v1/edge/heartbeat", nodeToken, req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// SubmitDiscoveryRun calls POST /api/v1/edge/discovery-runs. The
// envelope is left as a raw map for W1 because the sweep loop (W3+)
// hasn't introduced typed observation items yet. Once the typed
// shapes land they'll replace this signature.
func (c *Client) SubmitDiscoveryRun(ctx context.Context, nodeToken string, envelope any) (map[string]any, error) {
	var resp map[string]any
	if err := c.post(ctx, "/api/v1/edge/discovery-runs", nodeToken, envelope, &resp); err != nil {
		return nil, err
	}
	return resp, nil
}

// SubmitFederationCandidates reports expiring DNS-SD setup suggestions. The
// endpoint never creates a FederationLink or changes trust state.
func (c *Client) SubmitFederationCandidates(ctx context.Context, nodeToken string, snapshot FederationCandidateSnapshot) error {
	return c.post(ctx, "/api/v1/edge/federation-candidates", nodeToken, snapshot, nil)
}
