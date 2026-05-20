// Package state persists the Edge Node's enrollment record (nodeId +
// nodeToken + Authority-decided intervals + trustState) across restarts.
// Mirrors services/edge-node/src/state.ts byte-for-byte on the wire so
// either runtime can read state written by the other (wire-contract
// parity).
//
// Phase 0 storage: plain JSON at $DPF_EDGE_STATE_DIR/state.json with
// 0600 perms. OS-secure-store (Keychain, Credential Manager, libsecret)
// is the Phase-1+ target; for now the file-system controls (mode,
// owner) bound the risk.
//
// Read-time enforcement (POSIX hosts only — skipped on Windows where
// the TS implementation also skips it; both runtimes apply the
// equivalent ACL-based controls in Phase 1):
//   - File mode must be 0600. A loosened mode means the token in the
//     file may be exposed to anything running as the same group/world.
//   - File owner UID must match the current process UID. A different
//     owner means either a host bind-mount leaked another account's
//     state or the installer ran as a different account than the
//     runtime — in either case, the token isn't ours to use.
package state

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// EdgeNodeState mirrors the TypeScript StateSchema exactly. JSON tags
// must match so either runtime can read either's state file.
type EdgeNodeState struct {
	NodeID               string   `json:"nodeId"`
	NodeToken            string   `json:"nodeToken"`
	EnrolledAt           string   `json:"enrolledAt"` // RFC 3339 / ISO 8601
	HeartbeatIntervalSec int      `json:"heartbeatIntervalSec"`
	SweepIntervalSec     int      `json:"sweepIntervalSec"`
	MetricsIntervalSec   *int     `json:"metricsIntervalSec,omitempty"`
	AcceptedCapabilities []string `json:"acceptedCapabilities"`
	TrustState           string   `json:"trustState"` // pending | trusted | quarantined | revoked
}

const stateFilename = "state.json"

// Path returns the on-disk location of the state file.
func Path(stateDir string) string {
	return filepath.Join(stateDir, stateFilename)
}

// Load reads state from disk. Returns (nil, nil) when the file doesn't
// exist — the caller treats that as "first run" and triggers
// enrollment. Returns an error when the file exists but is corrupt,
// has the wrong mode, or has the wrong owner.
func Load(stateDir string) (*EdgeNodeState, error) {
	path := Path(stateDir)

	info, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("stat %s: %w", path, err)
	}

	if err := verifyPosixPerms(path, info); err != nil {
		return nil, err
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}

	var s EdgeNodeState
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, fmt.Errorf("state file %s is corrupt: %w", path, err)
	}
	if err := validate(&s); err != nil {
		return nil, fmt.Errorf("state file %s is missing required fields: %w", path, err)
	}
	return &s, nil
}

// Save atomically writes state to $stateDir/state.json with 0600 perms.
// Uses a tmp-file + rename so a crash mid-write leaves the previous
// state intact.
func Save(stateDir string, s *EdgeNodeState) error {
	if err := validate(s); err != nil {
		return fmt.Errorf("validate state before save: %w", err)
	}
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return fmt.Errorf("mkdir %s: %w", stateDir, err)
	}

	body, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal state: %w", err)
	}
	body = append(body, '\n')

	path := Path(stateDir)
	tmp := fmt.Sprintf("%s.tmp.%d", path, os.Getpid())

	// O_EXCL on the tmp file so two concurrent agents don't fight over
	// the same slot. If this fails because the tmp file already exists,
	// the operator can `rm` it; that's a rare recovery path.
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("open %s: %w", tmp, err)
	}
	if _, err := f.Write(body); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return fmt.Errorf("write %s: %w", tmp, err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("close %s: %w", tmp, err)
	}

	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename %s -> %s: %w", tmp, path, err)
	}

	// Re-chmod after rename in case the umask shifted bits. Best
	// effort on Windows where mode bits beyond the read-only attribute
	// are advisory.
	if shouldEnforcePosixPerms() {
		if err := os.Chmod(path, 0o600); err != nil {
			return fmt.Errorf("chmod %s: %w", path, err)
		}
	}
	return nil
}

// Clear deletes the state file. ENOENT is treated as success; the next
// start will trigger fresh enrollment.
func Clear(stateDir string) error {
	err := os.Remove(Path(stateDir))
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// validate enforces the same shape constraints the TypeScript
// StateSchema enforces. Any drift between this list and state.ts is a
// wire-contract regression — the parity tests catch it.
func validate(s *EdgeNodeState) error {
	if s == nil {
		return errors.New("state is nil")
	}
	if s.NodeID == "" {
		return errors.New("nodeId is required")
	}
	if s.NodeToken == "" {
		return errors.New("nodeToken is required")
	}
	if s.EnrolledAt == "" {
		return errors.New("enrolledAt is required")
	}
	if s.HeartbeatIntervalSec <= 0 {
		return errors.New("heartbeatIntervalSec must be a positive integer")
	}
	if s.SweepIntervalSec <= 0 {
		return errors.New("sweepIntervalSec must be a positive integer")
	}
	if s.MetricsIntervalSec != nil && *s.MetricsIntervalSec <= 0 {
		return errors.New("metricsIntervalSec, if set, must be a positive integer")
	}
	switch s.TrustState {
	case "pending", "trusted", "quarantined", "revoked":
	default:
		return fmt.Errorf("trustState %q is not one of pending|trusted|quarantined|revoked", s.TrustState)
	}
	if s.AcceptedCapabilities == nil {
		return errors.New("acceptedCapabilities is required (may be empty array)")
	}
	return nil
}
