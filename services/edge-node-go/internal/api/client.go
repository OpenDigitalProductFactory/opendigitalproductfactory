package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// HTTPError carries the status code and (when present) the Authority's
// structured error code so callers can branch on terminal failures
// (node_revoked, bootstrap_token_consumed) vs. transient ones.
type HTTPError struct {
	Status    int
	ErrorCode string // from response body's `error` field, may be empty
	Message   string
}

func (e *HTTPError) Error() string {
	if e.ErrorCode != "" {
		return fmt.Sprintf("authority HTTP %d (error=%s): %s", e.Status, e.ErrorCode, e.Message)
	}
	return fmt.Sprintf("authority HTTP %d: %s", e.Status, e.Message)
}

// IsRevoked reports whether this error is the terminal "node has been
// revoked" signal. The heartbeat loop watches for this to clear state.
func IsRevoked(err error) bool {
	var herr *HTTPError
	if !errors.As(err, &herr) {
		return false
	}
	return herr.Status == http.StatusUnauthorized && herr.ErrorCode == "node_revoked"
}

const defaultTimeout = 30 * time.Second

// Client wraps the small set of HTTP calls the Edge Node makes to the
// Authority Core's /api/v1/edge/* endpoints. One per process; the
// underlying http.Client is concurrency-safe.
type Client struct {
	base    string
	timeout time.Duration
	hc      *http.Client
}

// Options configure the Client. AuthorityURL is required; everything
// else has sane defaults.
type Options struct {
	// AuthorityURL e.g. "http://host.docker.internal:3000". Trailing
	// slashes are trimmed.
	AuthorityURL string

	// Timeout caps any single round-trip. Default 30s, matching the
	// TypeScript client at services/edge-node/src/api-client.ts.
	Timeout time.Duration

	// HTTPClient is exposed so tests can inject a custom Transport
	// pointed at httptest.Server. In production we build our own with
	// the resolved timeout.
	HTTPClient *http.Client
}

// New returns a configured Client. Returns an error if AuthorityURL is
// empty so callers don't accidentally point at "".
func New(opts Options) (*Client, error) {
	if opts.AuthorityURL == "" {
		return nil, errors.New("AuthorityURL is required")
	}
	timeout := opts.Timeout
	if timeout == 0 {
		timeout = defaultTimeout
	}
	hc := opts.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: timeout}
	}
	return &Client{
		base:    strings.TrimRight(opts.AuthorityURL, "/"),
		timeout: timeout,
		hc:      hc,
	}, nil
}

// post is the single transport seam every other call routes through.
// It encodes `body` as JSON, sets the Bearer auth header, POSTs to
// `path` (relative to the Authority base URL), and decodes the JSON
// response into `out`. Non-2xx responses become an *HTTPError carrying
// the status and any structured error code from the body.
func (c *Client) post(ctx context.Context, path, token string, body, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal request body for %s: %w", path, err)
	}

	// Per-call timeout. If the caller already provided a ctx with its
	// own deadline we honor the tighter of the two.
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build request for %s: %w", path, err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.hc.Do(req)
	if err != nil {
		return fmt.Errorf("post %s: %w", path, err)
	}
	defer resp.Body.Close()

	// Read fully so we can produce a useful error message on non-2xx
	// AND decode the success body. 1 MiB cap is generous for these
	// endpoints — enroll/heartbeat responses are sub-1KiB; discovery
	// submission responses are tiny acks. The Authority's per-item
	// size cap lives on the request side, not the response.
	respBytes, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("read response for %s: %w", path, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errBody AuthorityErrorBody
		if len(respBytes) > 0 {
			// Best effort — the Authority may return non-JSON for
			// certain 5xx paths (load balancer HTML, etc.). Don't fail
			// the error path on parse error; surface the raw bytes.
			_ = json.Unmarshal(respBytes, &errBody)
		}
		msg := errBody.Message
		if msg == "" {
			if len(respBytes) > 0 && len(respBytes) < 256 {
				msg = string(respBytes)
			} else {
				msg = fmt.Sprintf("authority returned %d for %s", resp.StatusCode, path)
			}
		}
		return &HTTPError{
			Status:    resp.StatusCode,
			ErrorCode: errBody.Error,
			Message:   msg,
		}
	}

	if out == nil {
		return nil
	}
	if err := json.Unmarshal(respBytes, out); err != nil {
		return fmt.Errorf("decode response for %s: %w", path, err)
	}
	return nil
}

// get is the authenticated read-only transport used by Authority-owned edge
// configuration endpoints. Keeping it beside post gives both paths the same
// timeout, response-size cap, and structured HTTP error semantics.
func (c *Client) get(ctx context.Context, path, token string, out any) error {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return fmt.Errorf("build request for %s: %w", path, err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := c.hc.Do(req)
	if err != nil {
		return fmt.Errorf("get %s: %w", path, err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("read response for %s: %w", path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errBody AuthorityErrorBody
		_ = json.Unmarshal(respBytes, &errBody)
		msg := errBody.Message
		if msg == "" {
			if len(respBytes) > 0 && len(respBytes) < 256 {
				msg = string(respBytes)
			} else {
				msg = fmt.Sprintf("authority returned %d for %s", resp.StatusCode, path)
			}
		}
		return &HTTPError{Status: resp.StatusCode, ErrorCode: errBody.Error, Message: msg}
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(respBytes, out); err != nil {
		return fmt.Errorf("decode response for %s: %w", path, err)
	}
	return nil
}

// Health verifies the portal independently of an organization bootstrap
// script's exit status. It intentionally accepts only a successful HTTP status;
// response content is not persisted as action evidence.
func (c *Client) Health(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/api/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("portal health returned HTTP %d", resp.StatusCode)
	}
	return nil
}
