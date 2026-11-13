package action

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"regexp"
)

// No automatic host-upkeep grant accompanies this operation. The server must
// approve the exact machine-bound change and the node must explicitly allow it.
const ManagedInferenceActionType = "inference.runtime.transition"

// The lifecycle implementation receives the original signed envelope only after
// verification and durable nonce consumption. It still owns current lease,
// qualification, package, selection, drain and rollback checks before effects.
type ManagedInferenceExecutor interface {
	Execute(context.Context, SignedEnvelope) (ExecutionOutput, error)
}

type managedInferenceParameters struct {
	Version                   int    `json:"version"`
	Operation                 string `json:"operation"`
	SourceSHA                 string `json:"sourceSha"`
	ProfileSHA256             string `json:"profileSha256"`
	RuntimeManifestSHA256     string `json:"runtimeManifestSha256"`
	QualificationReportSHA256 string `json:"qualificationReportSha256"`
	BaselineEngineSHA256      string `json:"baselineEngineSha256"`
	LeaseID                   string `json:"leaseId"`
}

var managedDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)
var managedSource = regexp.MustCompile(`^[a-f0-9]{40}$`)
var managedLease = regexp.MustCompile(`^NPEL-[A-Za-z0-9_-]{1,90}$`)

func parseManagedInferenceParameters(raw json.RawMessage) (managedInferenceParameters, error) {
	var p managedInferenceParameters
	if len(raw) == 0 || len(raw) > 2048 {
		return p, ErrInvalidParameters
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&p); err != nil {
		return p, ErrInvalidParameters
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return p, ErrInvalidParameters
	}
	if p.Version != 1 || (p.Operation != "activate" && p.Operation != "rollback") || !managedSource.MatchString(p.SourceSHA) || !managedLease.MatchString(p.LeaseID) {
		return p, ErrInvalidParameters
	}
	for _, digest := range []string{p.ProfileSHA256, p.RuntimeManifestSHA256, p.QualificationReportSHA256, p.BaselineEngineSHA256} {
		if !managedDigest.MatchString(digest) {
			return p, ErrInvalidParameters
		}
	}
	return p, nil
}
