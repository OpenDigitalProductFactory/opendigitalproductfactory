package action

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeStagedViewDoesNotAdoptAnotherHostsQualification(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	os.Chmod(root, 0700)
	report := []byte(`{"fixture":"source metadata only"}`)
	binding := map[string]string{"sourceSha": strings.Repeat("a", 40), "profileSha256": strings.Repeat("b", 64), "runtimeManifestSha256": strings.Repeat("c", 64), "qualificationReportSha256": nativeHash(report), "baselineEngineSha256": strings.Repeat("e", 64)}
	rawBinding, _ := json.Marshal(binding)
	release := filepath.Join(root, "mac-inference", "releases", nativeHash(rawBinding))
	if err := os.MkdirAll(release, 0700); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"schemaVersion": 1, "status": "staged", "activationAuthorized": false, "binding": binding, "hostNodeId": "edge-local", "physicalDevice": "Apple M5 Max"})
	os.WriteFile(filepath.Join(release, "release.json"), raw, 0600)
	os.WriteFile(filepath.Join(release, "qualification.json"), report, 0600)
	view, err := NativeInferenceStagedView(root, "edge-local")
	if err != nil || len(view.Profiles) != 1 {
		t.Fatalf("local staged profile missing: %#v %v", view, err)
	}
	other, err := NativeInferenceStagedView(root, "edge-other")
	if err != nil || len(other.Profiles) != 0 {
		t.Fatalf("foreign host qualification advertised: %#v %v", other, err)
	}
	os.WriteFile(filepath.Join(release, "qualification.json"), []byte("changed"), 0600)
	if _, err := NativeInferenceStagedView(root, "edge-local"); err == nil {
		t.Fatal("damaged staged report advertised")
	}
}
