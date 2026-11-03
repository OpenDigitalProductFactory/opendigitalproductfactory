package action

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

type NativeInferenceConfig struct {
	StateDirectory, EdgeStateDirectory, ControllerRoot string
	ControllerManifestSHA256, ControllerSourceSHA      string
	PublicKeyFile, BaselineEngine                      string
}

type NativeInferenceCommand struct {
	Program   string
	Args, Env []string
	Input     []byte
}

type NativeInferenceRunner func(context.Context, NativeInferenceCommand) ([]byte, error)

// Admission uses the existing machine-authenticated action client. Its bearer
// and client key stay in the parent, never in parameters or the child process.
type NativeManagedInferenceHandler struct {
	Config    NativeInferenceConfig
	NodeID    string
	PublicKey ed25519.PublicKey
	Now       func() time.Time
	Admission func(context.Context, SignedEnvelope) (SignedEnvelope, error)
	Run       NativeInferenceRunner
}

var ErrNativeInferenceFailed = errors.New("managed native inference transition failed")
var errNativeAdmissionLost = errors.New("native inference admission lost")

const nativeControllerEntry = "tools/mac-inference/runtime-controller.mjs"

type NativeControllerDescription struct{ SourceSHA, ManifestSHA256, NodePath, NodeSHA256, Entrypoint string }
type nativeControllerManifest struct {
	SchemaVersion        int                                    `json:"schemaVersion"`
	PackageName          string                                 `json:"packageName"`
	Version              string                                 `json:"version"`
	SourceSHA            string                                 `json:"sourceSha"`
	Entrypoint           string                                 `json:"entrypoint"`
	ActivationAuthorized bool                                   `json:"activationAuthorized"`
	Node                 struct{ Path, Version, SHA256 string } `json:"node"`
	Contract             struct {
		SchemaVersion                                            int `json:"schemaVersion"`
		Version, ActionType, Platform, Architecture, MinimumNode string
		Operations                                               []string
	} `json:"contract"`
	Files []struct {
		Path      string
		SizeBytes int64
		SHA256    string
	} `json:"files"`
}

func nativeFileHash(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
func nativePrivateDirectory(path string) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return ErrNativeInferenceFailed
	}
	canonical, err := filepath.EvalSymlinks(path)
	if err != nil || canonical != path {
		return ErrNativeInferenceFailed
	}
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || !nativeTrustedOwner(info) || info.Mode().Perm()&0077 != 0 {
		return ErrNativeInferenceFailed
	}
	for at := filepath.Dir(path); ; at = filepath.Dir(at) {
		info, err := os.Lstat(at)
		if err != nil || !info.IsDir() || !nativeTrustedOwner(info) || (info.Mode().Perm()&0022 != 0 && info.Mode()&os.ModeSticky == 0) {
			return ErrNativeInferenceFailed
		}
		if at == filepath.Dir(at) {
			break
		}
	}
	return nil
}
func nativeReadPrivate(path string, limit int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || !nativeTrustedOwner(info) || info.Mode().Perm()&0077 != 0 || info.Size() < 1 || info.Size() > limit {
		return nil, ErrNativeInferenceFailed
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return nil, ErrNativeInferenceFailed
	}
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(data)) != info.Size() {
		return nil, ErrNativeInferenceFailed
	}
	return data, nil
}

// This does not execute Node or read node credentials. The installer pins this
// manifest's bytes, and every listed file is checked before any child starts.
func VerifyNativeControllerPackage(cfg NativeInferenceConfig) (NativeControllerDescription, error) {
	var result NativeControllerDescription
	if !managedDigest.MatchString(cfg.ControllerManifestSHA256) || !managedSource.MatchString(cfg.ControllerSourceSHA) ||
		cfg.ControllerRoot != filepath.Join(cfg.StateDirectory, "native-inference-controller", cfg.ControllerSourceSHA) ||
		cfg.EdgeStateDirectory != filepath.Join(cfg.StateDirectory, "edge-node") || !filepath.IsAbs(cfg.PublicKeyFile) || !filepath.IsAbs(cfg.BaselineEngine) {
		return result, ErrNativeInferenceFailed
	}
	if err := nativePrivateDirectory(cfg.StateDirectory); err != nil {
		return result, err
	}
	if err := nativePrivateDirectory(cfg.ControllerRoot); err != nil {
		return result, err
	}
	raw, err := nativeReadPrivate(filepath.Join(cfg.ControllerRoot, "controller-manifest.json"), 65536)
	if err != nil {
		return result, err
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != cfg.ControllerManifestSHA256 {
		return result, ErrNativeInferenceFailed
	}
	var manifest nativeControllerManifest
	if json.Unmarshal(raw, &manifest) != nil || manifest.SchemaVersion != 1 || manifest.PackageName != "dpf-native-inference-controller" || manifest.Version != "1" ||
		manifest.SourceSHA != cfg.ControllerSourceSHA || manifest.Entrypoint != nativeControllerEntry || manifest.ActivationAuthorized ||
		manifest.Contract.SchemaVersion != 1 || manifest.Contract.Version != "1" || manifest.Contract.ActionType != ManagedInferenceActionType || manifest.Contract.Platform != "darwin" ||
		manifest.Contract.Architecture != "arm64" || manifest.Contract.MinimumNode != "22.18.0" || strings.Join(manifest.Contract.Operations, ",") != "activate,rollback" || len(manifest.Files) < 1 || len(manifest.Files) > 128 {
		return result, ErrNativeInferenceFailed
	}
	files := map[string]bool{}
	for _, record := range manifest.Files {
		clean := filepath.ToSlash(filepath.Clean(record.Path))
		if clean != record.Path || filepath.IsAbs(record.Path) || clean == ".." || strings.HasPrefix(clean, "../") || files[clean] || !managedDigest.MatchString(record.SHA256) || record.SizeBytes < 1 || record.SizeBytes > 512*1024 {
			return result, ErrNativeInferenceFailed
		}
		files[clean] = true
		target := filepath.Join(cfg.ControllerRoot, filepath.FromSlash(clean))
		resolved, err := filepath.EvalSymlinks(target)
		if err != nil || resolved != target {
			return result, ErrNativeInferenceFailed
		}
		bytes, err := nativeReadPrivate(target, 512*1024)
		if err != nil || int64(len(bytes)) != record.SizeBytes {
			return result, ErrNativeInferenceFailed
		}
		sum := sha256.Sum256(bytes)
		if hex.EncodeToString(sum[:]) != record.SHA256 {
			return result, ErrNativeInferenceFailed
		}
	}
	if !files[nativeControllerEntry] {
		return result, ErrNativeInferenceFailed
	}
	if err := filepath.WalkDir(cfg.ControllerRoot, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return ErrNativeInferenceFailed
		}
		if entry.IsDir() {
			return nativePrivateDirectory(path)
		}
		rel, err := filepath.Rel(cfg.ControllerRoot, path)
		if err != nil {
			return err
		}
		if rel != "controller-manifest.json" && !files[filepath.ToSlash(rel)] {
			return ErrNativeInferenceFailed
		}
		return nil
	}); err != nil {
		return result, err
	}
	info, err := os.Lstat(manifest.Node.Path)
	if err != nil || !filepath.IsAbs(manifest.Node.Path) || !info.Mode().IsRegular() || !nativeTrustedOwner(info) || info.Mode().Perm()&0022 != 0 || info.Mode().Perm()&0111 == 0 || !managedDigest.MatchString(manifest.Node.SHA256) {
		return result, ErrNativeInferenceFailed
	}
	resolved, err := filepath.EvalSymlinks(manifest.Node.Path)
	if err != nil || resolved != manifest.Node.Path {
		return result, ErrNativeInferenceFailed
	}
	hash, err := nativeFileHash(manifest.Node.Path)
	if err != nil || hash != manifest.Node.SHA256 {
		return result, ErrNativeInferenceFailed
	}
	return NativeControllerDescription{SourceSHA: manifest.SourceSHA, ManifestSHA256: cfg.ControllerManifestSHA256, NodePath: manifest.Node.Path, NodeSHA256: hash, Entrypoint: filepath.Join(cfg.ControllerRoot, nativeControllerEntry)}, nil
}

func (h *NativeManagedInferenceHandler) now() time.Time {
	if h.Now != nil {
		return h.Now().UTC()
	}
	return time.Now().UTC()
}
func (h *NativeManagedInferenceHandler) verifyAdmission(proof, original SignedEnvelope, digest string) error {
	now := h.now()
	if VerifyEnvelope(proof, h.PublicKey, h.NodeID, now, nil) != nil || proof.ActionType != "inference.runtime.admission" || proof.ActionKey != original.ActionKey {
		return errNativeAdmissionLost
	}
	issued, _ := time.Parse(time.RFC3339Nano, proof.IssuedAt)
	expires, _ := time.Parse(time.RFC3339Nano, proof.ExpiresAt)
	originalExpires, _ := time.Parse(time.RFC3339Nano, original.ExpiresAt)
	if issued.After(now) || expires.Sub(issued) > 30*time.Second || expires.After(originalExpires) {
		return errNativeAdmissionLost
	}
	var parameters struct {
		SchemaVersion           int    `json:"schemaVersion"`
		Ready                   bool   `json:"ready"`
		RequestDigest           string `json:"requestDigest"`
		LeaseID                 string `json:"leaseId"`
		OwnerSessionID          string `json:"ownerSessionId"`
		BranchName              string `json:"branchName"`
		QuiescenceRunID         string `json:"quiescenceRunId"`
		ApprovedChangeRequestID string `json:"approvedChangeRequestId"`
	}
	decoder := json.NewDecoder(bytes.NewReader(proof.Parameters))
	decoder.DisallowUnknownFields()
	originalParameters, err := parseManagedInferenceParameters(original.Parameters)
	if err != nil || decoder.Decode(&parameters) != nil || parameters.SchemaVersion != 1 || !parameters.Ready || parameters.RequestDigest != digest ||
		parameters.LeaseID != originalParameters.LeaseID || parameters.OwnerSessionID == "" || parameters.BranchName == "" || !strings.HasPrefix(parameters.QuiescenceRunID, "QR-") || parameters.ApprovedChangeRequestID == "" {
		return errNativeAdmissionLost
	}
	return nil
}
func nativeAdmissionFile(path string, value any) error {
	if info, err := os.Lstat(path); err == nil && !info.Mode().IsRegular() {
		return ErrNativeInferenceFailed
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".admission-")
	if err != nil {
		return err
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	if err = json.NewEncoder(file).Encode(value); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(temporary, path); err != nil {
		return err
	}
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func (h *NativeManagedInferenceHandler) Execute(ctx context.Context, signed SignedEnvelope) (ExecutionOutput, error) {
	output := ExecutionOutput{Evidence: map[string]any{"schemaVersion": 1, "nativeStatus": "not-started", "settlement": "confirmed", "actionKey": signed.ActionKey}}
	if runtime.GOOS != "darwin" || runtime.GOARCH != "arm64" {
		return output, ErrNativeInferenceFailed
	}
	verificationErr := VerifyEnvelope(signed, h.PublicKey, h.NodeID, h.now(), nil)
	// Temporal refusals are returned only after signature, node and lifetime checks.
	// Preserve the original receipt when time crossed after executor admission
	// and durable nonce consumption; expiry still forbids every host effect.
	if verificationErr != nil && verificationErr != ErrExpired && verificationErr != ErrNotYetValid {
		return output, ErrNativeInferenceFailed
	}
	parameters, err := parseManagedInferenceParameters(signed.Parameters)
	if err != nil {
		return output, ErrNativeInferenceFailed
	}
	canonical, err := CanonicalEnvelope(signed.Envelope)
	if err != nil {
		return output, err
	}
	sum := sha256.Sum256(canonical)
	digest := hex.EncodeToString(sum[:])
	output.Evidence["requestDigest"] = digest
	output.Evidence["sourceSha"] = parameters.SourceSHA
	if verificationErr != nil || h.Admission == nil || (parameters.Operation == "activate" && parameters.SourceSHA != h.Config.ControllerSourceSHA) {
		return output, ErrNativeInferenceFailed
	}
	controller, err := VerifyNativeControllerPackage(h.Config)
	if err != nil {
		return output, ErrNativeInferenceFailed
	}
	if err = nativePrivateDirectory(h.Config.EdgeStateDirectory); err != nil {
		return output, err
	}
	workspace, err := os.MkdirTemp(h.Config.EdgeStateDirectory, "inference-action-"+digest[:16]+"-")
	if err != nil {
		return output, err
	}
	admissionPath := filepath.Join(workspace, "admission.json")
	expiresAt, _ := time.Parse(time.RFC3339Nano, signed.ExpiresAt)
	operationContext, stop := context.WithDeadlineCause(ctx, expiresAt, errNativeAdmissionLost)
	defer stop()
	refresh := func() error {
		proof, err := h.Admission(operationContext, signed)
		if err != nil {
			return err
		}
		if err = h.verifyAdmission(proof, signed, digest); err != nil {
			return err
		}
		return nativeAdmissionFile(admissionPath, proof)
	}
	if err = refresh(); err != nil {
		return output, errNativeAdmissionLost
	}
	childContext, cancel := context.WithCancelCause(operationContext)
	defer cancel(nil)
	finished := make(chan struct{})
	var watcher sync.WaitGroup
	var admissionErr error
	var admissionMu sync.Mutex
	watcher.Add(1)
	go func() {
		defer watcher.Done()
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-finished:
				return
			case <-operationContext.Done():
				return
			case <-ticker.C:
				if err := refresh(); err != nil {
					admissionMu.Lock()
					admissionErr = err
					admissionMu.Unlock()
					_ = nativeAdmissionFile(admissionPath, map[string]any{"fenced": true})
					cancel(errNativeAdmissionLost)
					return
				}
			}
		}
	}()
	input, _ := json.Marshal(signed)
	env := []string{"PATH=/usr/bin:/bin:/usr/sbin:/sbin"}
	for _, key := range []string{"HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL"} {
		if value, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+value)
		}
	}
	command := NativeInferenceCommand{Program: controller.NodePath, Args: []string{controller.Entrypoint, "--state-directory", h.Config.StateDirectory, "--public-key", h.Config.PublicKeyFile,
		"--node-id", h.NodeID, "--admission-file", admissionPath, "--baseline-engine", h.Config.BaselineEngine}, Env: env, Input: input}
	runner := h.Run
	if runner == nil {
		runner = runNativeInferenceChild
	}
	raw, runErr := runner(childContext, command)
	close(finished)
	watcher.Wait()
	admissionMu.Lock()
	lost := admissionErr != nil
	admissionMu.Unlock()
	output.Evidence["nativeStatus"] = "uncertain"
	output.Evidence["settlement"] = "unknown"
	if lost || operationContext.Err() != nil {
		return output, ErrNativeInferenceFailed
	}
	var response struct {
		OK       bool           `json:"ok"`
		Result   map[string]any `json:"result"`
		Evidence map[string]any `json:"evidence"`
	}
	if len(raw) > 32768 || json.Unmarshal(raw, &response) != nil || response.Evidence["actionKey"] != signed.ActionKey || response.Evidence["requestDigest"] != digest || response.Evidence["sourceSha"] != parameters.SourceSHA {
		return output, ErrNativeInferenceFailed
	}
	status, settlement := response.Evidence["nativeStatus"], response.Evidence["settlement"]
	if settlement != "confirmed" && settlement != "unknown" {
		return output, ErrNativeInferenceFailed
	}
	if status != "active" && status != "rolled-back" && status != "failed-restored" && status != "not-started" && status != "uncertain" {
		return output, ErrNativeInferenceFailed
	}
	output = ExecutionOutput{Result: response.Result, Evidence: response.Evidence}
	if runErr != nil || !response.OK || settlement != "confirmed" || (parameters.Operation == "activate" && status != "active") || (parameters.Operation == "rollback" && status != "rolled-back") {
		return output, ErrNativeInferenceFailed
	}
	return output, nil
}

type nativeBoundedOutput struct {
	bytes.Buffer
	overflow bool
}

func (b *nativeBoundedOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 32768 {
		b.overflow = true
		return len(p), nil
	}
	return b.Buffer.Write(p)
}
func runNativeInferenceChild(ctx context.Context, command NativeInferenceCommand) ([]byte, error) {
	cmd := exec.Command(command.Program, command.Args...)
	cmd.Env = command.Env
	cmd.Stdin = bytes.NewReader(command.Input)
	var stdout, stderr nativeBoundedOutput
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	var err error
	select {
	case err = <-done:
	case <-ctx.Done():
		if errors.Is(context.Cause(ctx), errNativeAdmissionLost) {
			_ = signalNativeAuthorityFence(cmd.Process)
		} else {
			_ = cmd.Process.Signal(os.Interrupt)
		}
		select {
		case err = <-done:
		case <-time.After(45 * time.Second):
			_ = cmd.Process.Kill()
			select {
			case err = <-done:
			case <-time.After(10 * time.Second):
				return nil, ErrNativeInferenceFailed
			}
		}
		if err == nil {
			err = fmt.Errorf("native child cancelled: %w", ctx.Err())
		}
	}
	if stdout.overflow || stderr.overflow {
		return nil, ErrNativeInferenceFailed
	}
	return stdout.Bytes(), err
}
