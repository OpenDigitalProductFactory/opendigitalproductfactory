package collect

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/opendigitalproductfactory/dpf/services/edge-node-go/internal/oui"
)

// ArpEntry is one resolved IP↔MAC binding the kernel/OS knows about.
// Mirrors the TypeScript ArpEntry at services/edge-node/src/collectors/arp.ts.
type ArpEntry struct {
	IP    string // canonical dotted IPv4
	MAC   string // lower-case colon-separated, zero-padded bytes
	Iface string // OS-reported interface name (eth0, en0, Ethernet, etc.)
}

// SKIP_MACS mirrors the TS skip set. 00:00:00:00:00:00 = "ARP request
// outstanding but never resolved" (Linux Flags=0x0). FF:FF:FF:FF:FF:FF
// is L2 broadcast — the kernel may show it as a learned neighbor on
// some drivers but it's never a useful inventory item.
var skipMACs = map[string]struct{}{
	"00:00:00:00:00:00": {},
	"ff:ff:ff:ff:ff:ff": {},
}

// parseProcNetArp parses the Linux /proc/net/arp text format:
//
//	IP address       HW type     Flags     HW address            Mask     Device
//	192.168.1.1      0x1         0x2       aa:bb:cc:dd:ee:ff     *        eth0
//	10.0.0.5         0x1         0x0       00:00:00:00:00:00     *        eth0
//
// Flags is a bitfield; 0x2 = ATF_COM (complete entry). Entries with
// Flags=0x0 are unresolved and dropped to match the TS path's
// behavior at services/edge-node/src/collectors/arp.ts.
func parseProcNetArp(content string) []ArpEntry {
	out := make([]ArpEntry, 0, 16)
	for i, line := range strings.Split(content, "\n") {
		if i == 0 {
			continue // header row
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 6 {
			continue
		}
		ip := fields[0]
		flagsRaw := fields[2]
		mac := strings.ToLower(fields[3])
		iface := fields[5]

		flagsRaw = strings.TrimPrefix(flagsRaw, "0x")
		flagBits, err := strconv.ParseUint(flagsRaw, 16, 32)
		if err != nil {
			continue
		}
		if flagBits&0x2 != 0x2 {
			continue
		}
		if _, skip := skipMACs[mac]; skip {
			continue
		}
		if !isLikelyIPv4(ip) || !isLikelyMAC(mac) {
			continue
		}
		if !isUnicastLANAddress(ip) {
			continue
		}
		out = append(out, ArpEntry{IP: ip, MAC: mac, Iface: iface})
	}
	return dedupeArpByIP(out)
}

// macOS `arp -an` output:
//
//	? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]
//	? (192.168.1.20) at (incomplete) on en0 ifscope [ethernet]
//
// We drop the (incomplete) entries the same way Linux drops ATF_COM=0.
// macOS sometimes emits single-hex-digit bytes ("a:b:c:..."); we
// normalize to two-digit form.
var arpDashAnRE = regexp.MustCompile(
	`\(([\d.]+)\)\s+at\s+(\(incomplete\)|[0-9a-fA-F:]+)\s+on\s+(\S+)`,
)

func parseArpDashAn(content string) []ArpEntry {
	out := make([]ArpEntry, 0, 16)
	matches := arpDashAnRE.FindAllStringSubmatch(content, -1)
	for _, m := range matches {
		ip, macRaw, iface := m[1], m[2], m[3]
		if macRaw == "(incomplete)" {
			continue
		}
		mac := normalizeArpMAC(macRaw)
		if _, skip := skipMACs[mac]; skip {
			continue
		}
		if !isLikelyIPv4(ip) || !isLikelyMAC(mac) {
			continue
		}
		if !isUnicastLANAddress(ip) {
			continue
		}
		out = append(out, ArpEntry{IP: ip, MAC: mac, Iface: iface})
	}
	return dedupeArpByIP(out)
}

func isLikelyIPv4(s string) bool {
	parts := strings.Split(s, ".")
	if len(parts) != 4 {
		return false
	}
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 || n > 255 {
			return false
		}
	}
	return true
}

// isUnicastLANAddress filters out multicast (224.0.0.0/4), broadcast
// (255.255.255.255), and link-local (169.254.0.0/16) addresses. The
// Linux /proc/net/arp source already excludes multicast; Windows's
// GetIpNetTable includes them as "group → MAC" mappings even though
// they're not real LAN hosts. We drop them so the topology view
// isn't cluttered with bogus rows like "LAN Host 224.0.0.251".
//
// Caller has already proven isLikelyIPv4(); this checks the routing
// class of the address.
func isUnicastLANAddress(ip string) bool {
	parts := strings.Split(ip, ".")
	if len(parts) != 4 {
		return false
	}
	first, _ := strconv.Atoi(parts[0])
	second, _ := strconv.Atoi(parts[1])
	// 224.0.0.0/4 — IPv4 multicast.
	if first >= 224 && first <= 239 {
		return false
	}
	// 255.255.255.255 — broadcast.
	if ip == "255.255.255.255" {
		return false
	}
	// 169.254.0.0/16 — link-local. Not interesting for LAN inventory.
	if first == 169 && second == 254 {
		return false
	}
	// 0.0.0.0/8 — unspecified.
	if first == 0 {
		return false
	}
	return true
}

var likelyMACRE = regexp.MustCompile(`^[0-9a-f]{2}(:[0-9a-f]{2}){5}$`)

func isLikelyMAC(s string) bool {
	return likelyMACRE.MatchString(s)
}

// normalizeArpMAC turns "a:b:c:d:e:f" → "0a:0b:0c:0d:0e:0f" so every
// downstream consumer (and the cross-runtime parity tests) sees the
// canonical two-digit form. Mirrors the TS normalizeMac().
func normalizeArpMAC(raw string) string {
	parts := strings.Split(strings.ToLower(raw), ":")
	for i, b := range parts {
		if len(b) == 1 {
			parts[i] = "0" + b
		}
	}
	return strings.Join(parts, ":")
}

// dedupeArpByIP drops duplicate IPs across the result list. ARP caches
// can in theory list the same IP twice (proxy-ARP, multi-iface).
// Keeping the first match is stable across sweeps.
func dedupeArpByIP(entries []ArpEntry) []ArpEntry {
	seen := make(map[string]struct{}, len(entries))
	out := make([]ArpEntry, 0, len(entries))
	for _, e := range entries {
		if _, ok := seen[e.IP]; ok {
			continue
		}
		seen[e.IP] = struct{}{}
		out = append(out, e)
	}
	return out
}

// ArpResult bundles a collector run's output. Errors during the read
// become warnings; the sweep keeps going so one bad collector can't
// take down the whole submission.
type ArpResult struct {
	Entries  []ArpEntry
	Warnings []string
}

// arpToItems converts ArpEntries into ObservationItems matching the
// shape services/edge-node/src/collectors/arp.ts emits. Same
// observedKey, itemType, confidence, and rawData fields so the
// Authority's normalization treats Mode 1 (TS) and Mode 4 (Go)
// submissions as one set.
//
// OUI vendor enrichment matches PR #846's behavior in the TS path:
// when oui.Lookup() recognizes the MAC's manufacturer prefix, the
// item's name becomes "<short-vendor> <ip>" (e.g. "Amazon
// 192.168.0.49") and rawData gets vendor/vendorOui/vendorShort
// fields. Unknown OUIs fall back to "LAN Host <ip>" with no vendor
// fields — operators see the same shape regardless of which runtime
// submitted.
func arpToItems(entries []ArpEntry) []Item {
	items := make([]Item, 0, len(entries))
	for _, e := range entries {
		rawData := map[string]any{
			"address":        e.IP,
			"mac":            e.MAC,
			"iface":          e.Iface,
			"osiLayer":       3,
			"osiLayerName":   "network",
			"protocolFamily": "ipv4",
			"discoveredVia":  "arp_table",
		}

		// Vendor enrichment. The lookup is local-only — bundled IEEE
		// OUI dataset, no network call.
		name := fmt.Sprintf("LAN Host %s", e.IP)
		if vendor := oui.Lookup(e.MAC); vendor != nil {
			short := oui.ShortVendor(vendor.Vendor)
			name = fmt.Sprintf("%s %s", short, e.IP)
			rawData["vendor"] = vendor.Vendor
			rawData["vendorOui"] = vendor.OUI
			rawData["vendorShort"] = short
		}

		items = append(items, Item{
			ObservedKey: fmt.Sprintf("arp:%s", e.IP),
			ItemType:    "host",
			Name:        name,
			Confidence:  0.7,
			RawData:     rawData,
		})
	}
	return items
}

// ArpNeighbors reads the OS's ARP cache and returns one observation
// item per resolved IP/MAC pair. Errors degrade gracefully — a
// platform that doesn't expose ARP cleanly returns an empty result
// with a warning, not a panic.
func ArpNeighbors(adapter ...ArpAdapter) Result {
	a := DefaultArpAdapter
	if len(adapter) > 0 {
		a = adapter[0]
	}
	res := a()
	return Result{
		Items:    arpToItems(res.Entries),
		Warnings: res.Warnings,
	}
}

// ArpAdapter is the test seam. Production wires the platform-specific
// implementation in arp_{linux,darwin,windows,unsupported}.go.
type ArpAdapter func() ArpResult
