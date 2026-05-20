//go:build linux

package collect

import (
	"fmt"
	"os"
)

// DefaultArpAdapter reads /proc/net/arp on Linux. Same source the TS
// path uses at services/edge-node/src/collectors/arp.ts, so both
// runtimes producing identical ArpEntry rows.
var DefaultArpAdapter ArpAdapter = func() ArpResult {
	const path = "/proc/net/arp"
	content, err := os.ReadFile(path)
	if err != nil {
		return ArpResult{
			Warnings: []string{
				fmt.Sprintf("arp: /proc/net/arp read failed: %s", err),
			},
		}
	}
	return ArpResult{Entries: parseProcNetArp(string(content))}
}
