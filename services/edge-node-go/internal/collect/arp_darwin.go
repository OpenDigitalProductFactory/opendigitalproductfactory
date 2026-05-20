//go:build darwin

package collect

import (
	"context"
	"fmt"
	"os/exec"
	"time"
)

// DefaultArpAdapter shells to /usr/sbin/arp -an on macOS. Same source
// the TS path uses at services/edge-node/src/collectors/arp.ts.
//
// 5-second timeout — `arp -an` is local and should return in
// milliseconds; longer means the system is degenerate. We'd rather
// return an empty result with a warning than block the sweep.
var DefaultArpAdapter ArpAdapter = func() ArpResult {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/sbin/arp", "-an").Output()
	if err != nil {
		return ArpResult{
			Warnings: []string{
				fmt.Sprintf("arp: /usr/sbin/arp -an failed: %s", err),
			},
		}
	}
	return ArpResult{Entries: parseArpDashAn(string(out))}
}
