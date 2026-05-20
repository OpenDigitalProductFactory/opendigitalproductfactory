//go:build windows

package collect

import (
	"encoding/binary"
	"fmt"
	"net"
	"strconv"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// MIB_IPNETROW is the layout iphlpapi.dll's GetIpNetTable writes to
// the caller's buffer. Field names and Win32 type widths match
// https://learn.microsoft.com/en-us/windows/win32/api/iprtrmib/ns-iprtrmib-mib_ipnetrow_lh
//
// dwAddr and dwIndex are uint32 (4 bytes each). bPhysAddr is exactly 8
// bytes (the maximum MAC length); the actual length is bPhysAddrLen
// which is also uint32 — for normal Ethernet it's always 6.
//
// dwType is the kernel's MIB_IPNET_TYPE_* enum:
//
//	1 (MIB_IPNET_TYPE_OTHER)    — none of the below
//	2 (MIB_IPNET_TYPE_INVALID)  — never resolved, like Linux Flags=0
//	3 (MIB_IPNET_TYPE_DYNAMIC)  — learned via ARP, "resolved"
//	4 (MIB_IPNET_TYPE_STATIC)   — manually configured
//
// We accept DYNAMIC + STATIC + OTHER, drop INVALID — mirrors the
// Linux ATF_COM=0 filter the TS path uses.
type mibIPNetRow struct {
	DwIndex       uint32
	DwPhysAddrLen uint32
	BPhysAddr     [8]byte
	DwAddr        uint32
	DwType        uint32
}

const (
	mibIPNetTypeInvalid = 2
	noError             = 0
	errorInsufficientBuffer = 122
)

// DefaultArpAdapter reads the Windows ARP cache via GetIpNetTable on
// iphlpapi.dll. The plan calls for the syscall path (not `arp -a`
// shell-out) because it works in service contexts where arp.exe may
// not be on PATH and because it doesn't depend on stdout-format
// stability across Windows builds.
//
// Iteration through the table follows the standard two-call pattern:
//  1. Call once with a nil buffer to discover the required size.
//  2. Allocate, call again, decode the count + rows.
//
// The dynamic interface name resolution (DwIndex → "Ethernet 2")
// uses net.InterfaceByIndex from stdlib; works without additional
// Win32 calls.
var DefaultArpAdapter ArpAdapter = func() ArpResult {
	entries, warnings := readIPNetTable()
	return ArpResult{Entries: dedupeArpByIP(entries), Warnings: warnings}
}

func readIPNetTable() ([]ArpEntry, []string) {
	iphlpapi := windows.NewLazySystemDLL("iphlpapi.dll")
	getIPNetTable := iphlpapi.NewProc("GetIpNetTable")
	if err := getIPNetTable.Find(); err != nil {
		return nil, []string{fmt.Sprintf("arp: locate GetIpNetTable: %s", err)}
	}

	// First call — pass nil + size=0 to learn the required buffer
	// size. The kernel writes the size into our dwSize pointer and
	// returns ERROR_INSUFFICIENT_BUFFER (122).
	var bufSize uint32
	r1, _, _ := getIPNetTable.Call(
		uintptr(0),
		uintptr(unsafe.Pointer(&bufSize)),
		uintptr(0), // bOrder = FALSE; we sort ourselves if needed
	)
	if r1 != errorInsufficientBuffer && r1 != noError {
		return nil, []string{fmt.Sprintf("arp: GetIpNetTable size probe failed: %s", winErr(r1))}
	}
	if bufSize == 0 {
		// Empty ARP cache — fresh boot, no neighbors seen yet.
		return nil, nil
	}

	buf := make([]byte, bufSize)
	r1, _, _ = getIPNetTable.Call(
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&bufSize)),
		uintptr(0),
	)
	if r1 != noError {
		return nil, []string{fmt.Sprintf("arp: GetIpNetTable read failed: %s", winErr(r1))}
	}

	// The buffer layout is:
	//   DWORD dwNumEntries
	//   MIB_IPNETROW table[dwNumEntries]
	if len(buf) < int(unsafe.Sizeof(uint32(0))) {
		return nil, []string{"arp: GetIpNetTable returned undersized buffer"}
	}
	numEntries := binary.LittleEndian.Uint32(buf[:4])
	rowSize := int(unsafe.Sizeof(mibIPNetRow{}))
	expectedSize := 4 + int(numEntries)*rowSize
	if len(buf) < expectedSize {
		return nil, []string{
			fmt.Sprintf("arp: GetIpNetTable buffer smaller than numEntries=%d implies (got %d, want %d)",
				numEntries, len(buf), expectedSize),
		}
	}

	// Build an interface index → name lookup once; the ARP table can
	// have thousands of rows on a busy host and we don't want to call
	// net.InterfaceByIndex per row.
	ifaceNames := indexInterfaceNames()

	entries := make([]ArpEntry, 0, numEntries)
	var warnings []string
	cursor := 4 // skip dwNumEntries
	for i := uint32(0); i < numEntries; i++ {
		var row mibIPNetRow
		rowBytes := buf[cursor : cursor+rowSize]
		cursor += rowSize

		// Decode the fixed-layout struct. We can't just *(*mibIPNetRow)
		// the buffer because Go's escape analysis dislikes the trip
		// through unsafe.Pointer; the explicit decode is safer and
		// keeps the analyzer happy.
		row.DwIndex = binary.LittleEndian.Uint32(rowBytes[0:4])
		row.DwPhysAddrLen = binary.LittleEndian.Uint32(rowBytes[4:8])
		copy(row.BPhysAddr[:], rowBytes[8:16])
		row.DwAddr = binary.LittleEndian.Uint32(rowBytes[16:20])
		row.DwType = binary.LittleEndian.Uint32(rowBytes[20:24])

		if row.DwType == mibIPNetTypeInvalid {
			continue
		}
		if row.DwPhysAddrLen != 6 {
			// Non-Ethernet MAC width (Token Ring, etc.) — skip.
			continue
		}

		// DwAddr is in network byte order on Windows even though the
		// kernel exposes the rest of the struct in host order. The
		// MS docs are crisp about this and Tailscale's iphlpapi
		// wrappers agree.
		ipBytes := [4]byte{
			byte(row.DwAddr),
			byte(row.DwAddr >> 8),
			byte(row.DwAddr >> 16),
			byte(row.DwAddr >> 24),
		}
		ip := net.IP(ipBytes[:]).String()
		mac := formatMAC(row.BPhysAddr[:6])
		if _, skip := skipMACs[mac]; skip {
			continue
		}
		if !isLikelyIPv4(ip) || !isLikelyMAC(mac) {
			continue
		}
		// Drop multicast / link-local / broadcast addresses. Windows
		// includes the host's joined multicast groups in
		// GetIpNetTable (224.x.x.x mapped to 01:00:5e:* MACs); Linux
		// doesn't, and they're not real LAN hosts. See arp.go for
		// the full filter rationale.
		if !isUnicastLANAddress(ip) {
			continue
		}

		iface := ifaceNames[int(row.DwIndex)]
		if iface == "" {
			iface = "ifindex-" + strconv.Itoa(int(row.DwIndex))
		}
		entries = append(entries, ArpEntry{IP: ip, MAC: mac, Iface: iface})
	}

	return entries, warnings
}

func formatMAC(b []byte) string {
	// Equivalent to net.HardwareAddr(b).String() but avoids the
	// allocation overhead of constructing the slice. We always have
	// 6 bytes here.
	const hex = "0123456789abcdef"
	out := make([]byte, 17)
	for i, x := range b {
		out[i*3] = hex[x>>4]
		out[i*3+1] = hex[x&0x0f]
		if i < 5 {
			out[i*3+2] = ':'
		}
	}
	return string(out)
}

func indexInterfaceNames() map[int]string {
	ifs, err := net.Interfaces()
	if err != nil {
		return nil
	}
	out := make(map[int]string, len(ifs))
	for _, iface := range ifs {
		out[iface.Index] = iface.Name
	}
	return out
}

func winErr(rc uintptr) string {
	return syscall.Errno(rc).Error()
}
