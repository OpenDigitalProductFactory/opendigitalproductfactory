package action

import (
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	QualificationWindowsVerifyActionType = "qualification.windows.verify-v1"
	WindowsHandleReplacementProcedureID  = "windows-bound-node-test-v2"
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

type qualificationSourceFile struct {
	Path          string `json:"path"`
	BlobSHA       string `json:"blobSha"`
	ContentBase64 string `json:"contentBase64"`
}

type boundedOutputBuffer struct {
	bytes.Buffer
	limit     int
	truncated bool
}

func (b *boundedOutputBuffer) Write(value []byte) (int, error) {
	original := len(value)
	remaining := b.limit - b.Len()
	if remaining <= 0 {
		b.truncated = b.truncated || original > 0
		return original, nil
	}
	if len(value) > remaining {
		value = value[:remaining]
		b.truncated = true
	}
	_, err := b.Buffer.Write(value)
	return original, err
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
	SourceFiles                []qualificationSourceFile   `json:"sourceFiles"`
}

const qualificationSupportPath = "scripts/lib/evidence-validity-policy.mjs"

func gitBlobSHA(data []byte) string {
	h := sha1.New()
	_, _ = fmt.Fprintf(h, "blob %d\x00", len(data))
	_, _ = h.Write(data)
	return hex.EncodeToString(h.Sum(nil))
}

func validateQualificationSources(p qualificationWindowsParameters) bool {
	expected := make(map[string]string, len(p.ProductionBlobs)+len(p.TestBlobs)+1)
	for _, value := range append(append([]qualificationBlobIdentity{}, p.ProductionBlobs...), p.TestBlobs...) {
		if prior, exists := expected[value.Path]; exists && prior != value.BlobSHA {
			return false
		}
		expected[value.Path] = value.BlobSHA
	}
	expected[qualificationSupportPath] = ""
	if len(p.SourceFiles) != len(expected) {
		return false
	}
	seen := map[string]bool{}
	for _, source := range p.SourceFiles {
		want, ok := expected[source.Path]
		if !ok || seen[source.Path] || source.BlobSHA == "" || !sha40.MatchString(source.BlobSHA) || !safeRepositoryPath(source.Path) {
			return false
		}
		data, err := base64.StdEncoding.DecodeString(source.ContentBase64)
		if err != nil || len(data) > 1024*1024 || gitBlobSHA(data) != source.BlobSHA || (want != "" && want != source.BlobSHA) {
			return false
		}
		seen[source.Path] = true
	}
	return true
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
	invalid := p.Version != 2 || p.ResultSchemaVersion != 2 || p.ProcedureID != WindowsHandleReplacementProcedureID ||
		!backlogID.MatchString(p.BacklogItemID) || !workroomID.MatchString(p.WorkroomID) ||
		!repositoryID.MatchString(p.Repository) || !sha40.MatchString(p.BaseSHA) || !sha40.MatchString(p.HeadSHA) ||
		!sha40.MatchString(p.ProtocolBlobSHA) || !safeRepositoryPath(p.ProtocolPath) ||
		!validBlobList(p.ProductionBlobs) || !validBlobList(p.TestBlobs) ||
		!digest64.MatchString(p.QualificationBindingDigest) || p.MaxDurationSeconds < 1 || p.MaxDurationSeconds > 1800 ||
		!edgeIDPattern.MatchString(p.EdgeNodeID) || !validateQualificationSources(p)
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
	NodePath       string
	Now            func() time.Time
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
	for _, source := range p.SourceFiles {
		data, _ := base64.StdEncoding.DecodeString(source.ContentBase64)
		destination := filepath.Join(dir, filepath.FromSlash(source.Path))
		if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
			return ExecutionOutput{}, err
		}
		if err := os.WriteFile(destination, data, 0o600); err != nil {
			return ExecutionOutput{}, err
		}
	}
	nodePath := h.NodePath
	if nodePath == "" {
		nodePath, err = exec.LookPath("node")
	}
	if err != nil || !filepath.IsAbs(nodePath) {
		return ExecutionOutput{}, errors.New("qualified Node runtime is unavailable")
	}
	args := []string{"--test"}
	for _, test := range p.TestBlobs {
		args = append(args, filepath.FromSlash(test.Path))
	}
	command := exec.CommandContext(bounded, nodePath, args...)
	command.Dir = dir
	output := &boundedOutputBuffer{limit: 2 * 1024 * 1024}
	command.Stdout, command.Stderr = output, output
	runErr := command.Run()
	if errors.Is(bounded.Err(), context.DeadlineExceeded) {
		return ExecutionOutput{}, bounded.Err()
	}
	exitCode := 0
	if runErr != nil {
		var exitError *exec.ExitError
		if !errors.As(runErr, &exitError) {
			return ExecutionOutput{}, runErr
		}
		exitCode = exitError.ExitCode()
	}
	digest := sha256.Sum256(output.Bytes())
	disposition := "passed"
	if exitCode != 0 {
		disposition = "failed"
	}
	return ExecutionOutput{Result: map[string]any{"schemaVersion": 2, "disposition": disposition}, Evidence: map[string]any{
		"procedureId": p.ProcedureID, "procedureVersion": 2, "qualificationBindingDigest": p.QualificationBindingDigest,
		"baseSha": p.BaseSHA, "headSha": p.HeadSHA, "protocolPath": p.ProtocolPath,
		"protocolBlobSha": p.ProtocolBlobSHA, "productionBlobs": p.ProductionBlobs, "testBlobs": p.TestBlobs,
		"startedAt": started.Format(time.RFC3339Nano), "finishedAt": now().Format(time.RFC3339Nano),
		"command": strings.Join(append([]string{"node"}, args...), " "), "exitCode": exitCode,
		"sourceFileCount": len(p.SourceFiles), "boundedOutputDigest": hex.EncodeToString(digest[:]),
		"outputTruncated": output.truncated,
	}}, nil
}
