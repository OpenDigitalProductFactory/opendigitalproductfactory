package collect

import (
	"strings"
	"testing"
)

const procNetArpSample = `IP address       HW type     Flags     HW address            Mask     Device
192.168.1.1      0x1         0x2       aa:bb:cc:dd:ee:ff     *        eth0
192.168.1.42     0x1         0x2       11:22:33:44:55:66     *        eth0
192.168.1.5      0x1         0x0       00:00:00:00:00:00     *        eth0
192.168.1.6      0x1         0x2       ff:ff:ff:ff:ff:ff     *        eth0
10.0.0.99        0x1         0x2       AA:BB:CC:11:22:33     *        wlan0
`

func TestParseProcNetArp_acceptsCompleteEntries(t *testing.T) {
	got := parseProcNetArp(procNetArpSample)
	if len(got) != 3 {
		t.Fatalf("entry count = %d, want 3 (got: %+v)", len(got), got)
	}
}

func TestParseProcNetArp_skipsATFCOMZero(t *testing.T) {
	for _, e := range parseProcNetArp(procNetArpSample) {
		if e.IP == "192.168.1.5" {
			t.Errorf("expected Flags=0x0 entry 192.168.1.5 to be skipped")
		}
	}
}

func TestParseProcNetArp_skipsBroadcastMAC(t *testing.T) {
	for _, e := range parseProcNetArp(procNetArpSample) {
		if e.MAC == "ff:ff:ff:ff:ff:ff" {
			t.Errorf("expected broadcast MAC to be skipped, got %+v", e)
		}
	}
}

func TestParseProcNetArp_normalizesMACToLowercase(t *testing.T) {
	got := parseProcNetArp(procNetArpSample)
	for _, e := range got {
		if e.IP == "10.0.0.99" && e.MAC != "aa:bb:cc:11:22:33" {
			t.Errorf("expected lowercase MAC, got %q", e.MAC)
		}
	}
}

func TestParseProcNetArp_toleratesBlankLines(t *testing.T) {
	content := procNetArpSample + "\n\n  \n"
	if got := parseProcNetArp(content); len(got) != 3 {
		t.Fatalf("entries after blanks = %d, want 3", len(got))
	}
}

func TestParseProcNetArp_skipsHeader(t *testing.T) {
	// A malformed file with no header should still parse what's there.
	contentNoHeader := `192.168.0.1     0x1   0x2   00:11:22:33:44:55   *   eth0`
	if got := parseProcNetArp(contentNoHeader); len(got) != 0 {
		t.Errorf("header-less first line should be treated as header and skipped, got %+v", got)
	}
}

const arpDashAnSample = `? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]
? (192.168.1.20) at (incomplete) on en0 ifscope [ethernet]
? (10.0.0.5) at a:b:c:d:e:f on en1 ifscope [ethernet]
? (192.168.1.99) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]
? (192.168.1.100) at 00:00:00:00:00:00 on en0 ifscope [ethernet]
`

func TestParseArpDashAn_acceptsResolvedEntries(t *testing.T) {
	got := parseArpDashAn(arpDashAnSample)
	if len(got) != 2 {
		t.Fatalf("entry count = %d, want 2: %+v", len(got), got)
	}
}

func TestParseArpDashAn_skipsIncompleteEntries(t *testing.T) {
	for _, e := range parseArpDashAn(arpDashAnSample) {
		if e.IP == "192.168.1.20" {
			t.Errorf("(incomplete) entry should not appear: %+v", e)
		}
	}
}

func TestParseArpDashAn_padsSingleHexDigitMAC(t *testing.T) {
	// macOS sometimes emits "a:b:c:d:e:f" instead of "0a:0b:..."; the
	// pipeline must produce the canonical two-digit form so the
	// Authority's normalization dedupes Mode 1 (TS) and Mode 4 (Go)
	// observations as one entity.
	got := parseArpDashAn(arpDashAnSample)
	for _, e := range got {
		if e.IP == "10.0.0.5" && e.MAC != "0a:0b:0c:0d:0e:0f" {
			t.Errorf("expected zero-padded MAC, got %q", e.MAC)
		}
	}
}

func TestParseArpDashAn_skipsBroadcastAndAllZeros(t *testing.T) {
	for _, e := range parseArpDashAn(arpDashAnSample) {
		if e.MAC == "ff:ff:ff:ff:ff:ff" || e.MAC == "00:00:00:00:00:00" {
			t.Errorf("expected broadcast / all-zeros MAC to be skipped, got %+v", e)
		}
	}
}

func TestDedupeArpByIP_keepsFirstOccurrence(t *testing.T) {
	in := []ArpEntry{
		{IP: "192.168.0.1", MAC: "aa:bb:cc:00:00:01", Iface: "eth0"},
		{IP: "192.168.0.2", MAC: "aa:bb:cc:00:00:02", Iface: "eth0"},
		{IP: "192.168.0.1", MAC: "ff:ff:ff:00:00:01", Iface: "eth1"},
	}
	got := dedupeArpByIP(in)
	if len(got) != 2 {
		t.Fatalf("deduped count = %d, want 2", len(got))
	}
	if got[0].MAC != "aa:bb:cc:00:00:01" {
		t.Errorf("first occurrence not preserved: %+v", got[0])
	}
}

func TestArpNeighbors_returnsItemsWithCanonicalShape(t *testing.T) {
	// DE:AD:BE is a private/reserved OUI not in the IEEE registry,
	// so this entry hits the unknown-vendor path and we can assert
	// the unenriched item shape.
	stub := ArpAdapter(func() ArpResult {
		return ArpResult{
			Entries: []ArpEntry{
				{IP: "192.168.0.10", MAC: "de:ad:be:dd:ee:ff", Iface: "eth0"},
			},
		}
	})
	got := ArpNeighbors(stub)
	if len(got.Items) != 1 {
		t.Fatalf("Items = %d, want 1", len(got.Items))
	}
	item := got.Items[0]
	if item.ObservedKey != "arp:192.168.0.10" {
		t.Errorf("observedKey = %q", item.ObservedKey)
	}
	if item.ItemType != "host" {
		t.Errorf("itemType = %q", item.ItemType)
	}
	if item.Confidence != 0.7 {
		t.Errorf("confidence = %v, want 0.7", item.Confidence)
	}
	for _, key := range []string{"address", "mac", "iface", "osiLayer", "discoveredVia"} {
		if _, ok := item.RawData[key]; !ok {
			t.Errorf("rawData missing %q", key)
		}
	}
	if item.RawData["discoveredVia"] != "arp_table" {
		t.Errorf("discoveredVia = %v", item.RawData["discoveredVia"])
	}
	if item.Name != "LAN Host 192.168.0.10" {
		t.Errorf("name = %q, want 'LAN Host 192.168.0.10'", item.Name)
	}
	if _, ok := item.RawData["vendor"]; ok {
		t.Errorf("unknown OUI should not stamp vendor field")
	}
}

func TestArpNeighbors_enrichesItemsWithKnownVendor(t *testing.T) {
	// FC:A1:83 is one of Amazon Technologies Inc.'s OUIs in the
	// bundled IEEE registry. The collector should stamp vendor
	// fields and rebrand the item's name.
	stub := ArpAdapter(func() ArpResult {
		return ArpResult{
			Entries: []ArpEntry{
				{IP: "192.168.0.49", MAC: "fc:a1:83:de:ad:be", Iface: "Wi-Fi"},
			},
		}
	})
	got := ArpNeighbors(stub)
	if len(got.Items) != 1 {
		t.Fatalf("Items = %d, want 1", len(got.Items))
	}
	item := got.Items[0]
	vendor, _ := item.RawData["vendor"].(string)
	if !strings.HasPrefix(vendor, "Amazon") {
		t.Errorf("vendor = %q, want starts with 'Amazon'", vendor)
	}
	if item.RawData["vendorOui"] != "FCA183" {
		t.Errorf("vendorOui = %v, want FCA183", item.RawData["vendorOui"])
	}
	short, _ := item.RawData["vendorShort"].(string)
	if short != "Amazon" {
		t.Errorf("vendorShort = %q, want Amazon", short)
	}
	if item.Name != "Amazon 192.168.0.49" {
		t.Errorf("name = %q, want 'Amazon 192.168.0.49'", item.Name)
	}
}

func TestArpNeighbors_propagatesAdapterWarnings(t *testing.T) {
	stub := ArpAdapter(func() ArpResult {
		return ArpResult{Warnings: []string{"arp: read failed"}}
	})
	got := ArpNeighbors(stub)
	if len(got.Items) != 0 {
		t.Errorf("Items = %d, want 0", len(got.Items))
	}
	if len(got.Warnings) != 1 || !strings.Contains(got.Warnings[0], "read failed") {
		t.Errorf("Warnings = %v", got.Warnings)
	}
}

func TestArpNeighbors_emptyAdapterIsEmptyResult(t *testing.T) {
	stub := ArpAdapter(func() ArpResult { return ArpResult{} })
	got := ArpNeighbors(stub)
	if len(got.Items) != 0 || len(got.Warnings) != 0 {
		t.Errorf("expected empty result, got %+v", got)
	}
}

func TestIsLikelyIPv4(t *testing.T) {
	for _, ok := range []string{"0.0.0.0", "192.168.1.1", "255.255.255.255"} {
		if !isLikelyIPv4(ok) {
			t.Errorf("expected %q to be a valid IPv4", ok)
		}
	}
	for _, bad := range []string{"", "1.2.3", "1.2.3.4.5", "999.0.0.0", "abc.0.0.0", "1.2.3.x"} {
		if isLikelyIPv4(bad) {
			t.Errorf("expected %q to be rejected", bad)
		}
	}
}

func TestIsUnicastLANAddress(t *testing.T) {
	for _, ok := range []string{"192.168.0.1", "10.0.0.5", "172.16.255.254", "8.8.8.8"} {
		if !isUnicastLANAddress(ok) {
			t.Errorf("expected %q to be a unicast LAN address", ok)
		}
	}
	for _, bad := range []string{
		"224.0.0.1",         // multicast
		"224.0.0.251",       // mDNS
		"239.255.255.250",   // SSDP
		"233.89.188.1",      // multicast (RTP-MIDI etc)
		"255.255.255.255",   // broadcast
		"169.254.1.1",       // APIPA link-local
		"0.0.0.0",           // unspecified
	} {
		if isUnicastLANAddress(bad) {
			t.Errorf("expected %q to be rejected", bad)
		}
	}
}

func TestIsLikelyMAC(t *testing.T) {
	for _, ok := range []string{"aa:bb:cc:dd:ee:ff", "00:11:22:33:44:55"} {
		if !isLikelyMAC(ok) {
			t.Errorf("expected %q to be a valid MAC", ok)
		}
	}
	for _, bad := range []string{
		"", "AA:BB:CC:DD:EE:FF" /* upper-case rejected by the package's lower-cased form */, "a:b:c:d:e:f", "00-11-22-33-44-55",
	} {
		if isLikelyMAC(bad) {
			t.Errorf("expected %q to be rejected", bad)
		}
	}
}

func TestNormalizeArpMAC(t *testing.T) {
	for input, want := range map[string]string{
		"a:b:c:d:e:f":         "0a:0b:0c:0d:0e:0f",
		"AA:BB:CC:DD:EE:FF":   "aa:bb:cc:dd:ee:ff",
		"00:11:22:33:44:55":   "00:11:22:33:44:55",
		"0a:bB:0c:0d:0e:0f":   "0a:bb:0c:0d:0e:0f",
	} {
		if got := normalizeArpMAC(input); got != want {
			t.Errorf("normalizeArpMAC(%q) = %q, want %q", input, got, want)
		}
	}
}
