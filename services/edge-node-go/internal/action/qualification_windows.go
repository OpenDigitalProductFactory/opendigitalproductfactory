package action

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"time"
)

const (
	QualificationWindowsVerifyActionType = "qualification.windows.verify-v1"
	WindowsHandleReplacementProcedureID  = "windows-handle-replacement-v1"
)

var (
	errQualificationPlatform = errors.New("Windows qualification is unavailable on this platform")
	sha40                    = regexp.MustCompile(`^[a-f0-9]{40}$`)
	digest64                 = regexp.MustCompile(`^[a-f0-9]{64}$`)
	backlogID                = regexp.MustCompile(`^BI-[A-Z0-9]+$`)
	workroomID               = regexp.MustCompile(`^WC-[A-Z0-9]+$`)
	repositoryID             = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)
	edgeIDPattern            = regexp.MustCompile(`^edge_[A-Za-z0-9_-]{1,100}$`)
)

type qualificationBlobIdentity struct {
	Path    string `json:"path"`
	BlobSHA string `json:"blobSha"`
}

type qualificationWindowsParameters struct {
	Version                    int                         `json:"version"`
	BacklogItemID              string                      `json:"backlogItemId"`
	WorkroomID                 string                      `json:"workroomId"`
	Repository                 string                      `json:"repository"`
	BaseSHA                    string                      `json:"baseSha"`
	HeadSHA                    string                      `json:"headSha"`
	ProtocolPath               string                      `json:"protocolPath"`
	ProtocolBlobSHA            string                      `json:"protocolBlobSha"`
	ProductionBlobs            []qualificationBlobIdentity `json:"productionBlobs"`
	TestBlobs                  []qualificationBlobIdentity `json:"testBlobs"`
	QualificationBindingDigest string                      `json:"qualificationBindingDigest"`
	ProcedureID                string                      `json:"procedureId"`
	ResultSchemaVersion        int                         `json:"resultSchemaVersion"`
	MaxDurationSeconds         int                         `json:"maxDurationSeconds"`
	EdgeNodeID                 string                      `json:"edgeNodeId"`
}

func safeRepositoryPath(value string) bool {
	if value == "" || len(value) > 500 || path.IsAbs(value) || path.Clean(value) != value || filepath.IsAbs(value) {
		return false
	}
	return !regexp.MustCompile(`(^|[/\\])\.\.([/\\]|$)`).MatchString(value) && !regexp.MustCompile(`\\`).MatchString(value)
}

func validBlobList(values []qualificationBlobIdentity) bool {
	if len(values) == 0 || len(values) > 100 {
		return false
	}
	for _, value := range values {
		if !safeRepositoryPath(value.Path) || !sha40.MatchString(value.BlobSHA) {
			return false
		}
	}
	return true
}

func parseQualificationWindowsParameters(raw json.RawMessage) (qualificationWindowsParameters, error) {
	var p qualificationWindowsParameters
	decoder := json.NewDecoder(bytesReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&p); err != nil {
		return p, ErrInvalidParameters
	}
	var extra any
	if decoder.Decode(&extra) == nil {
		return p, ErrInvalidParameters
	}
	invalid := p.Version != 1 || p.ResultSchemaVersion != 1 || p.ProcedureID != WindowsHandleReplacementProcedureID ||
		!backlogID.MatchString(p.BacklogItemID) || !workroomID.MatchString(p.WorkroomID) ||
		!repositoryID.MatchString(p.Repository) || !sha40.MatchString(p.BaseSHA) || !sha40.MatchString(p.HeadSHA) ||
		!sha40.MatchString(p.ProtocolBlobSHA) || !safeRepositoryPath(p.ProtocolPath) ||
		!validBlobList(p.ProductionBlobs) || !validBlobList(p.TestBlobs) ||
		!digest64.MatchString(p.QualificationBindingDigest) || p.MaxDurationSeconds < 1 || p.MaxDurationSeconds > 1800 ||
		!edgeIDPattern.MatchString(p.EdgeNodeID)
	if invalid {
		return p, ErrInvalidParameters
	}
	return p, nil
}

// bytesReader is kept local so schema validation has no generic command or IO surface.
func bytesReader(raw []byte) *bytes.Reader { return bytes.NewReader(raw) }

type QualificationWindowsExecutor interface {
	Execute(context.Context, json.RawMessage) (ExecutionOutput, error)
}

type QualificationWindowsHandler struct {
	Platform       string
	StateDirectory string
	Now            func() time.Time
	openHeldFile   func(string) (io.Closer, error)
	replaceFile    func(string, string) error
}

func (h *QualificationWindowsHandler) Execute(ctx context.Context, raw json.RawMessage) (ExecutionOutput, error) {
	p, err := parseQualificationWindowsParameters(raw)
	if err != nil {
		return ExecutionOutput{}, err
	}
	if h.Platform != "win32" {
		return ExecutionOutput{}, errQualificationPlatform
	}
	now := h.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	started := now()
	bounded, cancel := context.WithTimeout(ctx, time.Duration(p.MaxDurationSeconds)*time.Second)
	defer cancel()
	dir, err := os.MkdirTemp(h.StateDirectory, "qualification-windows-")
	if err != nil {
		return ExecutionOutput{}, err
	}
	defer func() { _ = os.RemoveAll(dir) }()
	target := filepath.Join(dir, "held.txt")
	original := []byte(`{"status":"before"}`)
	replacement := []byte(`{"status":"after"}`)
	if err := os.WriteFile(target, original, 0o600); err != nil {
		return ExecutionOutput{}, err
	}
	openHeldFile := h.openHeldFile
	if openHeldFile == nil {
		openHeldFile = openQualificationHandle
	}
	replace := h.replaceFile
	if replace == nil {
		replace = os.Rename
	}
	held, err := openHeldFile(target)
	if err != nil {
		return ExecutionOutput{}, err
	}
	firstSource := filepath.Join(dir, "replacement-one.txt")
	if err := os.WriteFile(firstSource, replacement, 0o600); err != nil {
		_ = held.Close()
		return ExecutionOutput{}, err
	}
	firstErr := replace(firstSource, target)
	firstTarget := fileContentDisposition(target, original, replacement)
	firstSourceCleanup := removeDisposition(firstSource)
	if err := held.Close(); err != nil {
		return ExecutionOutput{}, err
	}
	secondSource := filepath.Join(dir, "replacement-two.txt")
	if err := os.WriteFile(secondSource, replacement, 0o600); err != nil {
		return ExecutionOutput{}, err
	}
	secondErr := replace(secondSource, target)
	secondTarget := fileContentDisposition(target, nil, replacement)
	select {
	case <-bounded.Done():
		return ExecutionOutput{}, bounded.Err()
	default:
	}
	cleanup := "removed"
	if cleanupErr := os.RemoveAll(dir); cleanupErr != nil {
		cleanup = fmt.Sprintf("refused:%T", cleanupErr)
	}
	observations := map[string]any{
		"firstReplacement": outcome(firstErr), "firstTarget": firstTarget,
		"firstSourceCleanup": firstSourceCleanup, "handleRelease": "closed",
		"secondReplacement": outcome(secondErr), "secondTarget": secondTarget, "cleanup": cleanup,
	}
	encoded, _ := json.Marshal(observations)
	digest := sha256.Sum256(encoded)
	return ExecutionOutput{Result: map[string]any{"schemaVersion": 1, "disposition": "observed"}, Evidence: map[string]any{
		"procedureId": p.ProcedureID, "procedureVersion": 1, "qualificationBindingDigest": p.QualificationBindingDigest,
		"platform": runtime.GOOS, "architecture": runtime.GOARCH,
		"baseSha": p.BaseSHA, "headSha": p.HeadSHA, "protocolPath": p.ProtocolPath,
		"protocolBlobSha": p.ProtocolBlobSHA, "productionBlobs": p.ProductionBlobs, "testBlobs": p.TestBlobs,
		"startedAt": started.Format(time.RFC3339Nano), "finishedAt": now().Format(time.RFC3339Nano),
		"observations": observations, "boundedOutputDigest": hex.EncodeToString(digest[:]),
	}}, nil
}

func fileContentDisposition(file string, preserved, updated []byte) string {
	contents, err := os.ReadFile(file)
	if err != nil {
		return fmt.Sprintf("unreadable:%T", err)
	}
	if preserved != nil && bytes.Equal(contents, preserved) {
		return "preserved"
	}
	if bytes.Equal(contents, updated) {
		return "updated"
	}
	return "unexpected"
}

func removeDisposition(file string) string {
	err := os.Remove(file)
	if err == nil {
		return "removed"
	}
	if errors.Is(err, os.ErrNotExist) {
		return "not-present"
	}
	return fmt.Sprintf("refused:%T", err)
}

func outcome(err error) string {
	if err == nil {
		return "replaced"
	}
	return fmt.Sprintf("refused:%T", err)
}
