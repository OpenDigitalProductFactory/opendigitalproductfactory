//go:build !linux && !darwin && !windows

package collect

import "runtime"

// DefaultArpAdapter for platforms the Edge Node doesn't officially
// target yet (FreeBSD, OpenBSD, etc.). Returns empty + a warning so
// cross-compile builds still produce a working binary; the operator
// just won't see ARP entries until a platform implementation lands.
var DefaultArpAdapter ArpAdapter = func() ArpResult {
	return ArpResult{
		Warnings: []string{
			"arp: collector not implemented for " + runtime.GOOS,
		},
	}
}
