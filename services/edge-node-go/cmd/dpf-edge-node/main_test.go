package main

import (
	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/action"
	"testing"
)

func TestNativeInferenceCapabilityRequiresRegisteredVerifiedController(t *testing.T) {
	nativeInferenceController.Store(nil)
	t.Cleanup(func() { nativeInferenceController.Store(nil) })
	read := func() map[string]any {
		for _, report := range capabilityReports(true, false, "", hostUpkeepReport{}) {
			if report.Capability == "action.execute" {
				return report.Evidence
			}
		}
		t.Fatal("missing action channel")
		return nil
	}
	if _, present := read()["managedInference"]; present {
		t.Fatal("unregistered controller advertised")
	}
	description := &action.NativeControllerDescription{SourceSHA: "source", ManifestSHA256: "manifest"}
	nativeInferenceController.Store(description)
	evidence := read()
	if !containsString(evidence["actionTypes"].([]string), action.ManagedInferenceActionType) {
		t.Fatalf("registered native transition missing: %#v", evidence)
	}
	metadata, ok := evidence["managedInference"].(map[string]any)
	if !ok || metadata["sourceSha"] != "source" || metadata["controllerManifestSha256"] != "manifest" {
		t.Fatalf("wrong controller identity: %#v", metadata)
	}
	if _, ok := metadata["nodePath"]; ok {
		t.Fatal("private executable path disclosed")
	}
	for _, report := range capabilityReports(false, false, "", hostUpkeepReport{}) {
		if report.Capability == "action.execute" {
			t.Fatal("native controller bypassed missing trust bundle")
		}
	}
}

func TestCapabilityReportsAdvertisesActionExecuteOnlyWithCompleteTrustBundle(t *testing.T) {
	actionDispatchHealth.Store(actionDispatchHealthy)
	reports := capabilityReports(true, true, "authority", hostUpkeepReport{})
	if len(reports) != 2 || reports[1].Capability != "action.execute" || reports[1].Status != "healthy" {
		t.Fatalf("expected healthy action.execute report, got %#v", reports)
	}
	actionTypes := reports[1].Evidence["actionTypes"].([]string)
	if len(actionTypes) != 2 || actionTypes[1] != "organization.join.issue" || reports[1].Evidence["organizationTrustRole"] != "authority" {
		t.Fatalf("expected role-bound join action, got %#v", reports[1])
	}

	reports = capabilityReports(false, true, "authority", hostUpkeepReport{})
	if len(reports) != 1 || reports[0].Capability != "federation.discovery" {
		t.Fatalf("unconfigured action channel must not be advertised, got %#v", reports)
	}
}

// BI-28EFE18A: a host-upkeep agent advertises the restart and its Docker runtime.
func TestCapabilityReportsAdvertiseTheVmRestartAndDockerRuntime(t *testing.T) {
	reports := capabilityReports(true, false, "", hostUpkeepReport{dockerVmRestart: true, dockerRuntime: "engine"})
	var evidence map[string]any
	for _, report := range reports {
		if report.Capability == "action.execute" {
			evidence = report.Evidence
		}
	}
	if evidence == nil || evidence["dockerRuntime"] != "engine" {
		t.Fatalf("evidence=%v", evidence)
	}
	found := false
	for _, actionType := range evidence["actionTypes"].([]string) {
		if actionType == "substrate.docker-vm.restart" {
			found = true
		}
	}
	if !found {
		t.Fatalf("restart not advertised: %v", evidence["actionTypes"])
	}
}
