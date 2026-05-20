package collect

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"runtime"
	"sort"
	"strings"
	"time"
)

// HostFacts is the cross-platform fact set the host-info collector
// produces. Platform-specific helpers (osRelease, osVersion) live in
// build-tag-split files; everything else here is portable.
type HostFacts struct {
	Hostname          string
	Platform          string // win32 | darwin | linux  (matches wire contract)
	GoOS              string // runtime.GOOS — kept alongside Platform for debugging
	Arch              string // amd64 | arm64 | ...
	Release           string // e.g. "Microsoft Windows 11 Pro" or "Ubuntu 22.04.5 LTS"
	KernelVersion     string // e.g. "10.0.22631" or "5.15.0-58-generic"
	CPUCount          int
	NetworkInterfaces []NetworkInterface
}

// NetworkInterface summarises one NIC. Mirrors the TS host-info
// shape; the array goes into rawData.networkInterfaces.
type NetworkInterface struct {
	Name      string                 `json:"name"`
	MAC       string                 `json:"mac,omitempty"`
	MTU       int                    `json:"mtu,omitempty"`
	Up        bool                   `json:"up"`
	Internal  bool                   `json:"internal"`
	Addresses []NetworkInterfaceAddr `json:"addresses"`
}

// NetworkInterfaceAddr is one address bound to a NIC. Family is "IPv4"
// or "IPv6" to match the TS wire contract literal.
type NetworkInterfaceAddr struct {
	Family   string `json:"family"`
	Address  string `json:"address"`
	CIDR     string `json:"cidr,omitempty"`
	Internal bool   `json:"internal"`
}

// HostInfoAdapter is the seam tests inject through. Production wires
// real OS calls; tests substitute fixtures.
type HostInfoAdapter struct {
	Hostname          func() (string, error)
	GoOS              func() string
	Arch              func() string
	CPUCount          func() int
	NetworkInterfaces func() ([]net.Interface, error)
	InterfaceAddrs    func(iface net.Interface) ([]net.Addr, error)
	OSRelease         func() (release string, kernel string, err error)
	Now               func() time.Time
}

// DefaultAdapter wires the real platform calls. Per-platform OSRelease
// implementations live in osinfo_{windows,linux,darwin}.go; the
// hostinfo.go file stays portable.
var DefaultAdapter = HostInfoAdapter{
	Hostname: os.Hostname,
	GoOS:     func() string { return runtime.GOOS },
	Arch:     func() string { return runtime.GOARCH },
	CPUCount: runtime.NumCPU,
	NetworkInterfaces: func() ([]net.Interface, error) {
		return net.Interfaces()
	},
	InterfaceAddrs: func(iface net.Interface) ([]net.Addr, error) {
		return iface.Addrs()
	},
	OSRelease: osRelease, // build-tag-split
	Now:       time.Now,
}

// HostInfo gathers a single observation item describing the machine
// the agent runs on. Mirrors collectHostInfo() in
// services/edge-node/src/collectors/host-info.ts: same observedKey
// shape, same rawData fields, plus the OS release + kernel details
// the TS path couldn't get from Node's `os` module without shelling
// out.
//
// Errors degrade gracefully — a network-interface read failure
// becomes a warning, the host item still flows.
func HostInfo(adapter ...HostInfoAdapter) Result {
	a := DefaultAdapter
	if len(adapter) > 0 {
		a = adapter[0]
	}

	var warnings []string

	hostname, err := a.Hostname()
	if err != nil {
		warnings = append(warnings, fmt.Sprintf("host-info: hostname read failed: %s", err))
		hostname = "unknown-host"
	}

	goOS := a.GoOS()
	platform := wirePlatform(goOS)

	release, kernel := "", ""
	if a.OSRelease != nil {
		r, k, err := a.OSRelease()
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("host-info: OS release detection failed: %s", err))
		}
		release, kernel = r, k
	}

	nics, err := a.NetworkInterfaces()
	if err != nil {
		warnings = append(warnings, fmt.Sprintf("host-info: network interface enumeration failed: %s", err))
	}

	ifaceSummaries := make([]NetworkInterface, 0, len(nics))
	for _, iface := range nics {
		summary := summarizeInterface(a, iface)
		// Match the TS path's behavior: skip interfaces with no
		// bound addresses (down NICs, virtual stubs).
		if len(summary.Addresses) == 0 {
			continue
		}
		ifaceSummaries = append(ifaceSummaries, summary)
	}

	fingerprint := fingerprintHost(platform, hostname)

	item := Item{
		ObservedKey: fmt.Sprintf("host:%s:%s", platform, fingerprint),
		ItemType:    "host",
		Name:        hostname,
		Confidence:  1.0,
		RawData: map[string]any{
			"hostname":          hostname,
			"platform":          platform,
			"goos":              goOS,
			"arch":              a.Arch(),
			"release":           release,
			"kernelVersion":     kernel,
			"cpuCount":          a.CPUCount(),
			"networkInterfaces": ifaceSummaries,
		},
	}

	return Result{
		Items:    []Item{item},
		Warnings: warnings,
	}
}

func summarizeInterface(a HostInfoAdapter, iface net.Interface) NetworkInterface {
	addrs, err := a.InterfaceAddrs(iface)
	if err != nil {
		// One bad NIC shouldn't tank the whole collector. We surface
		// nothing about this iface and move on — the operator can
		// see the missing entry in the admin UI's diff vs other
		// runs if it matters.
		return NetworkInterface{Name: iface.Name}
	}

	internalGuess := isInternalInterface(iface, addrs)
	summary := NetworkInterface{
		Name:     iface.Name,
		MAC:      iface.HardwareAddr.String(),
		MTU:      iface.MTU,
		Up:       iface.Flags&net.FlagUp != 0,
		Internal: internalGuess,
	}

	for _, addr := range addrs {
		ipNet, ok := addr.(*net.IPNet)
		if !ok {
			continue
		}
		family := "IPv6"
		if ipNet.IP.To4() != nil {
			family = "IPv4"
		}
		summary.Addresses = append(summary.Addresses, NetworkInterfaceAddr{
			Family:   family,
			Address:  ipNet.IP.String(),
			CIDR:     ipNet.String(),
			Internal: ipNet.IP.IsLoopback() || ipNet.IP.IsLinkLocalUnicast(),
		})
	}
	return summary
}

// wirePlatform converts Go's GOOS to the wire-contract platform string
// the Authority's Zod schema accepts ("win32" rather than "windows").
// Matches resolvePlatform() in internal/config so the two never drift.
func wirePlatform(goOS string) string {
	if goOS == "windows" {
		return "win32"
	}
	return goOS
}

// isInternalInterface tries to identify the loopback NIC ("lo" on
// Linux, "Loopback" on Windows). Net.FlagLoopback is the right
// signal; we also fall back to the conventional name when the flag is
// somehow missing.
func isInternalInterface(iface net.Interface, _ []net.Addr) bool {
	if iface.Flags&net.FlagLoopback != 0 {
		return true
	}
	name := strings.ToLower(iface.Name)
	return name == "lo" || strings.HasPrefix(name, "loopback")
}

// fingerprintHost produces a stable, non-PII-leaking key for the host.
// Hashing platform+hostname gives a stable observedKey across sweeps
// while keeping the raw hostname out of the key field (still present
// in rawData.hostname for operator readability). Mirrors the TS
// equivalent at host-info.ts.
func fingerprintHost(platform, hostname string) string {
	sum := sha256.Sum256([]byte(platform + ":" + hostname))
	return hex.EncodeToString(sum[:])[:16]
}

// RealLANAddresses returns the non-loopback / non-link-local IPv4 +
// IPv6 addresses bound to the host's interfaces, sorted IPv4 first.
// Used at enrollment + heartbeat to populate EdgeNode.metadata.host
// without forcing the admin UI to parse the full discovery payload.
// Mirrors collectHostNetworkSummary() in host-network.ts.
func RealLANAddresses(adapter ...HostInfoAdapter) []string {
	a := DefaultAdapter
	if len(adapter) > 0 {
		a = adapter[0]
	}
	nics, err := a.NetworkInterfaces()
	if err != nil {
		return nil
	}
	seen := make(map[string]bool)
	out := make([]string, 0, 8)
	for _, iface := range nics {
		if iface.Flags&net.FlagUp == 0 {
			continue
		}
		if iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := a.InterfaceAddrs(iface)
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			if ipNet.IP.IsLoopback() || ipNet.IP.IsLinkLocalUnicast() {
				continue
			}
			s := ipNet.IP.String()
			if seen[s] {
				continue
			}
			seen[s] = true
			out = append(out, s)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		iV4 := !strings.Contains(out[i], ":")
		jV4 := !strings.Contains(out[j], ":")
		if iV4 != jV4 {
			return iV4
		}
		return out[i] < out[j]
	})
	return out
}
