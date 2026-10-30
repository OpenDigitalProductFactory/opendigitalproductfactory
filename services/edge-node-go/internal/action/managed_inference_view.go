package action

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

func nativeHashBytes(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }

// Advertised artifact metadata is an offer, never machine authority or proof
// of current qualification. The handler verifies actual files and host facts
// again after an approved signed action has acquired its current admission.
type NativeInferenceView struct {
	Profiles  []map[string]string `json:"stagedProfiles"`
	Selection map[string]any      `json:"selection"`
}

func NativeInferenceStagedView(stateDirectory, nodeID string) (NativeInferenceView, error) {
	view := NativeInferenceView{Profiles: []map[string]string{}, Selection: map[string]any{"mode": "docker"}}
	if err := nativePrivateDirectory(stateDirectory); err != nil {
		return view, err
	}
	store := filepath.Join(stateDirectory, "mac-inference", "releases")
	if _, err := os.Lstat(store); os.IsNotExist(err) {
		return view, nil
	}
	if err := nativePrivateDirectory(store); err != nil {
		return view, err
	}
	entries, err := os.ReadDir(store)
	if err != nil || len(entries) > 32 {
		return view, ErrNativeInferenceFailed
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".staging-") {
			continue
		}
		if !managedDigest.MatchString(entry.Name()) {
			return view, ErrNativeInferenceFailed
		}
		release := filepath.Join(store, entry.Name())
		if err := nativePrivateDirectory(release); err != nil {
			return view, err
		}
		raw, err := nativeReadPrivate(filepath.Join(release, "release.json"), 16384)
		if err != nil {
			return view, err
		}
		var record struct {
			SchemaVersion        int               `json:"schemaVersion"`
			Status               string            `json:"status"`
			ActivationAuthorized bool              `json:"activationAuthorized"`
			Binding              map[string]string `json:"binding"`
			HostNodeID           string            `json:"hostNodeId"`
			PhysicalDevice       string            `json:"physicalDevice"`
		}
		if json.Unmarshal(raw, &record) != nil || record.SchemaVersion != 1 || record.Status != "staged" || record.ActivationAuthorized {
			return view, ErrNativeInferenceFailed
		}
		if record.HostNodeID != nodeID {
			continue
		}
		binding := record.Binding
		if len(binding) != 5 || !managedSource.MatchString(binding["sourceSha"]) || record.PhysicalDevice != "Apple M5 Max" {
			return view, ErrNativeInferenceFailed
		}
		for _, key := range []string{"profileSha256", "runtimeManifestSha256", "qualificationReportSha256", "baselineEngineSha256"} {
			if !managedDigest.MatchString(binding[key]) {
				return view, ErrNativeInferenceFailed
			}
		}
		rawBinding, _ := json.Marshal(binding)
		if nativeHashBytes(rawBinding) != entry.Name() {
			return view, ErrNativeInferenceFailed
		}
		report, err := nativeReadPrivate(filepath.Join(release, "qualification.json"), 65536)
		if err != nil || nativeHashBytes(report) != binding["qualificationReportSha256"] {
			return view, ErrNativeInferenceFailed
		}
		profile := map[string]string{"hostNodeId": nodeID, "physicalDevice": record.PhysicalDevice}
		for key, value := range binding {
			profile[key] = value
		}
		view.Profiles = append(view.Profiles, profile)
	}
	raw, err := nativeReadPrivate(filepath.Join(stateDirectory, "install-state.json"), 262144)
	if err != nil {
		if _, statErr := os.Lstat(filepath.Join(stateDirectory, "install-state.json")); os.IsNotExist(statErr) {
			return view, nil
		}
		return view, err
	}
	var install struct {
		Managed map[string]any `json:"managedInference"`
	}
	if json.Unmarshal(raw, &install) != nil {
		return view, ErrNativeInferenceFailed
	}
	if install.Managed == nil {
		return view, nil
	}
	m := install.Managed
	if m["nodeId"] != nodeID {
		return view, ErrNativeInferenceFailed
	}
	mode, _ := m["mode"].(string)
	if mode != "native" && mode != "docker" && mode != "transitioning" && mode != "uncertain" {
		return view, ErrNativeInferenceFailed
	}
	selected := map[string]any{"mode": mode}
	for _, key := range []string{"actionKey", "sourceSha", "profileSha256", "runtimeManifestSha256", "qualificationReportSha256", "baselineEngineSha256"} {
		if value, ok := m[key].(string); ok {
			selected[key] = value
		} else {
			return view, ErrNativeInferenceFailed
		}
	}
	view.Selection = selected
	return view, nil
}
