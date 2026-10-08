package main

import "testing"

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
