package main

import "testing"

func TestCapabilityReportsAdvertisesActionExecuteOnlyWithCompleteTrustBundle(t *testing.T) {
	actionDispatchHealth.Store(actionDispatchHealthy)
	reports := capabilityReports(true)
	if len(reports) != 2 || reports[1].Capability != "action.execute" || reports[1].Status != "healthy" {
		t.Fatalf("expected healthy action.execute report, got %#v", reports)
	}

	reports = capabilityReports(false)
	if len(reports) != 1 || reports[0].Capability != "federation.discovery" {
		t.Fatalf("unconfigured action channel must not be advertised, got %#v", reports)
	}
}
