package main

import "testing"

func TestCapabilityReportsAdvertisesActionExecuteOnlyWithCompleteTrustBundle(t *testing.T) {
	actionDispatchHealth.Store(actionDispatchHealthy)
	reports := capabilityReports(true, true, "authority")
	if len(reports) != 2 || reports[1].Capability != "action.execute" || reports[1].Status != "healthy" {
		t.Fatalf("expected healthy action.execute report, got %#v", reports)
	}
	actionTypes := reports[1].Evidence["actionTypes"].([]string)
	if len(actionTypes) != 2 || actionTypes[1] != "organization.join.issue" || reports[1].Evidence["organizationTrustRole"] != "authority" {
		t.Fatalf("expected role-bound join action, got %#v", reports[1])
	}

	reports = capabilityReports(false, true, "authority")
	if len(reports) != 1 || reports[0].Capability != "federation.discovery" {
		t.Fatalf("unconfigured action channel must not be advertised, got %#v", reports)
	}
}
