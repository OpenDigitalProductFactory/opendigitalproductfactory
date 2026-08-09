package api

import "context"

// FetchAdapters returns the active, scope-matched collector configurations for
// a trusted edge node. The Authority decrypts credentials only after edge auth.
func (c *Client) FetchAdapters(ctx context.Context, nodeToken string) (*AdaptersResponse, error) {
	var response AdaptersResponse
	if err := c.get(ctx, "/api/v1/edge/adapters", nodeToken, &response); err != nil {
		return nil, err
	}
	return &response, nil
}
