package collect

import (
	"errors"
	"net"
	"strings"
	"testing"
	"time"
)

// ipnet builds a *net.IPNet shaped like what iface.Addrs() returns at
// runtime: IP is the host's actual address, Mask is the network mask.
// net.ParseCIDR by itself returns the network address (.0) — not what
// a real NIC reports — so we splice in the host portion manually.
func ipnet(s string) *net.IPNet {
	ip, n, err := net.ParseCIDR(s)
	if err != nil {
		panic(err)
	}
	return &net.IPNet{IP: ip, Mask: n.Mask}
}

func sampleAdapter() HostInfoAdapter {
	mac, _ := net.ParseMAC("aa:bb:cc:dd:ee:ff")
	ifs := []net.Interface{
		{Index: 1, MTU: 1500, Name: "eth0", HardwareAddr: mac, Flags: net.FlagUp | net.FlagBroadcast},
		{Index: 2, MTU: 65536, Name: "lo", Flags: net.FlagUp | net.FlagLoopback},
		{Index: 3, MTU: 1500, Name: "eth1-down", HardwareAddr: mac},
	}
	addrs := map[string][]net.Addr{
		"eth0":      {ipnet("192.168.0.10/24"), ipnet("fe80::1/64"), ipnet("2001:db8::1/64")},
		"lo":        {ipnet("127.0.0.1/8"), ipnet("::1/128")},
		"eth1-down": {},
	}
	return HostInfoAdapter{
		Hostname:          func() (string, error) { return "test-host", nil },
		GoOS:              func() string { return "linux" },
		Arch:              func() string { return "amd64" },
		CPUCount:          func() int { return 8 },
		NetworkInterfaces: func() ([]net.Interface, error) { return ifs, nil },
		InterfaceAddrs: func(iface net.Interface) ([]net.Addr, error) {
			return addrs[iface.Name], nil
		},
		OSRelease: func() (string, string, error) {
			return "Test Linux 1.0", "1.0-test", nil
		},
		Now: func() time.Time { return time.Unix(1716240000, 0) },
	}
}

func TestHostInfo_returnsExactlyOneHostItem(t *testing.T) {
	result := HostInfo(sampleAdapter())
	if len(result.Items) != 1 {
		t.Fatalf("Items count = %d, want 1", len(result.Items))
	}
	if result.Items[0].ItemType != "host" {
		t.Errorf("ItemType = %q, want host", result.Items[0].ItemType)
	}
	if result.Items[0].Name != "test-host" {
		t.Errorf("Name = %q, want test-host", result.Items[0].Name)
	}
}

func TestHostInfo_observedKeyIsStableAcrossCalls(t *testing.T) {
	r1 := HostInfo(sampleAdapter())
	r2 := HostInfo(sampleAdapter())
	if r1.Items[0].ObservedKey != r2.Items[0].ObservedKey {
		t.Errorf("observedKey changed: %q vs %q", r1.Items[0].ObservedKey, r2.Items[0].ObservedKey)
	}
	if !strings.HasPrefix(r1.Items[0].ObservedKey, "host:linux:") {
		t.Errorf("observedKey shape: %q", r1.Items[0].ObservedKey)
	}
}

func TestHostInfo_observedKeyDoesNotContainRawHostname(t *testing.T) {
	// The TS implementation hashes the hostname so the observedKey
	// doesn't leak PII. Same expectation on the Go side.
	result := HostInfo(sampleAdapter())
	if strings.Contains(result.Items[0].ObservedKey, "test-host") {
		t.Errorf("observedKey leaks raw hostname: %q", result.Items[0].ObservedKey)
	}
}

func TestHostInfo_rawDataCarriesAllExpectedFields(t *testing.T) {
	result := HostInfo(sampleAdapter())
	raw := result.Items[0].RawData
	for _, key := range []string{
		"hostname", "platform", "goos", "arch", "release", "kernelVersion",
		"cpuCount", "networkInterfaces",
	} {
		if _, ok := raw[key]; !ok {
			t.Errorf("rawData missing key %q", key)
		}
	}
	if raw["platform"] != "linux" {
		t.Errorf("platform = %v", raw["platform"])
	}
	if raw["release"] != "Test Linux 1.0" {
		t.Errorf("release = %v", raw["release"])
	}
}

func TestHostInfo_mapsWindowsGOOSToWin32(t *testing.T) {
	a := sampleAdapter()
	a.GoOS = func() string { return "windows" }
	a.OSRelease = func() (string, string, error) { return "Windows 11 Pro", "10.0.22631.4317", nil }
	result := HostInfo(a)
	if result.Items[0].RawData["platform"] != "win32" {
		t.Errorf("platform = %v, want win32", result.Items[0].RawData["platform"])
	}
	if !strings.HasPrefix(result.Items[0].ObservedKey, "host:win32:") {
		t.Errorf("observedKey did not pick up win32: %q", result.Items[0].ObservedKey)
	}
}

func TestHostInfo_skipsInterfacesWithNoAddresses(t *testing.T) {
	result := HostInfo(sampleAdapter())
	nics, ok := result.Items[0].RawData["networkInterfaces"].([]NetworkInterface)
	if !ok {
		t.Fatalf("networkInterfaces wrong type: %T", result.Items[0].RawData["networkInterfaces"])
	}
	for _, nic := range nics {
		if nic.Name == "eth1-down" {
			t.Errorf("expected eth1-down (no addrs) to be filtered out")
		}
	}
}

func TestHostInfo_marksLoopbackAndLinkLocalAsInternal(t *testing.T) {
	result := HostInfo(sampleAdapter())
	nics := result.Items[0].RawData["networkInterfaces"].([]NetworkInterface)
	for _, nic := range nics {
		if nic.Name == "lo" {
			if !nic.Internal {
				t.Errorf("lo not marked internal")
			}
		}
		if nic.Name == "eth0" {
			// fe80::/64 is link-local; should show internal=true on
			// that one address. The IPv4 address must be internal=false.
			for _, addr := range nic.Addresses {
				if addr.Address == "192.168.0.10" && addr.Internal {
					t.Errorf("192.168.0.10 should not be internal")
				}
				if strings.HasPrefix(addr.Address, "fe80") && !addr.Internal {
					t.Errorf("fe80::* should be internal")
				}
			}
		}
	}
}

func TestHostInfo_propagatesHostnameError_asWarning(t *testing.T) {
	a := sampleAdapter()
	a.Hostname = func() (string, error) { return "", errors.New("EACCES") }
	result := HostInfo(a)
	if len(result.Warnings) == 0 || !strings.Contains(result.Warnings[0], "hostname read failed") {
		t.Errorf("expected hostname warning, got %v", result.Warnings)
	}
	if result.Items[0].Name != "unknown-host" {
		t.Errorf("expected fallback hostname, got %q", result.Items[0].Name)
	}
}

func TestHostInfo_propagatesOSReleaseError_asWarning(t *testing.T) {
	a := sampleAdapter()
	a.OSRelease = func() (string, string, error) {
		return "", "", errors.New("registry locked")
	}
	result := HostInfo(a)
	if len(result.Warnings) == 0 || !strings.Contains(result.Warnings[0], "OS release") {
		t.Errorf("expected OS-release warning, got %v", result.Warnings)
	}
	// Host item still emitted.
	if len(result.Items) != 1 {
		t.Errorf("expected host item even on OS release failure, got %d", len(result.Items))
	}
}

func TestRealLANAddresses_filtersLoopbackAndLinkLocal(t *testing.T) {
	got := RealLANAddresses(sampleAdapter())
	for _, ip := range got {
		if strings.HasPrefix(ip, "127.") || ip == "::1" {
			t.Errorf("loopback %q leaked", ip)
		}
		if strings.HasPrefix(ip, "fe80") {
			t.Errorf("link-local %q leaked", ip)
		}
	}
	// Should contain the routable address from eth0.
	found := false
	for _, ip := range got {
		if ip == "192.168.0.10" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected 192.168.0.10 in result, got %v", got)
	}
}

func TestRealLANAddresses_sortsIPv4BeforeIPv6(t *testing.T) {
	got := RealLANAddresses(sampleAdapter())
	if len(got) < 2 {
		t.Skip("not enough addresses to test ordering")
	}
	// First should be IPv4 (no colon).
	if strings.Contains(got[0], ":") {
		t.Errorf("expected IPv4 first, got %v", got)
	}
}
