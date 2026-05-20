package api

import "context"

// Enroll calls POST /api/v1/edge/enroll with the bootstrap token. The
// bootstrap token is single-use; the Authority consumes it on success
// and refuses it on the next call. Callers must persist the returned
// nodeToken via the state package and use that for all subsequent calls.
func (c *Client) Enroll(ctx context.Context, bootstrapToken string, req EnrollRequest) (*EnrollResponse, error) {
	var resp EnrollResponse
	if err := c.post(ctx, "/api/v1/edge/enroll", bootstrapToken, req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}
