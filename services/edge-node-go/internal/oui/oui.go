// Package oui maps MAC address prefixes to manufacturer names via the
// bundled IEEE OUI registry. Functional parity with the TypeScript
// path at apps/web/lib/edge-node/mac-oui.ts (added in PR #846); same
// dataset, same shortVendor normalization, same MAC normalization
// rules — so an ARP entry observed by either runtime produces the
// same vendor label after enrichment.
//
// The IEEE OUI dataset (~39k entries, ~1.2 MB compact TSV) ships
// embedded in the Go binary via go:embed. The binary grows by about
// the same amount, which is well inside the few-MB headroom we have
// for cross-platform native distribution. No filesystem read at
// runtime — the dataset is available from the first call.
//
// Source-of-truth: this PR maintains a copy of services/edge-node/data/
// oui.tsv at services/edge-node-go/data/oui.tsv. A future consolidation
// PR will move both runtimes to a single repo-level dataset.
package oui

import (
	_ "embed"
	"regexp"
	"strings"
	"sync"
)

//go:embed data/oui.tsv
var ouiTSV string

// Entry is the result of a successful Lookup. The oui field is the
// 6-hex-char uppercase prefix; vendor is the IEEE-registered name.
type Entry struct {
	OUI    string
	Vendor string
}

// once + cache match the TS implementation's lazy-on-first-call
// pattern. Building the Map costs ~50 ms one-shot on the first ARP
// entry of the first sweep; every subsequent lookup is O(1).
var (
	once  sync.Once
	cache map[string]string
)

// macSeparators are the characters operators / OSes use between MAC
// bytes: colon, dash, dot, plus whitespace as a defensive measure.
var macSeparators = regexp.MustCompile(`[\s:.\-]`)

// macHex validates the 12-hex-char canonical form we normalize to.
var macHex = regexp.MustCompile(`^[0-9A-F]{12}$`)

// NormalizeMAC converts any reasonable MAC representation to the
// canonical upper-case 12-hex-no-separator form. Returns "" on
// anything that doesn't look like a MAC. Mirrors normalizeMac() in
// the TS path so both runtimes accept identical inputs.
func NormalizeMAC(raw string) string {
	cleaned := strings.ToUpper(macSeparators.ReplaceAllString(raw, ""))
	if !macHex.MatchString(cleaned) {
		return ""
	}
	return cleaned
}

// Lookup returns the manufacturer entry for the OUI prefix of mac, or
// nil if the MAC can't be parsed or the prefix isn't in the dataset.
func Lookup(mac string) *Entry {
	normalized := NormalizeMAC(mac)
	if normalized == "" {
		return nil
	}
	prefix := normalized[:6]
	loadCache()
	vendor, ok := cache[prefix]
	if !ok {
		return nil
	}
	return &Entry{OUI: prefix, Vendor: vendor}
}

func loadCache() {
	once.Do(func() {
		cache = make(map[string]string, 40_000)
		for _, line := range strings.Split(ouiTSV, "\n") {
			if line == "" || line[0] == '#' {
				continue
			}
			tab := strings.IndexByte(line, '\t')
			if tab < 0 {
				continue
			}
			oui := strings.ToUpper(strings.TrimSpace(line[:tab]))
			if len(oui) != 6 {
				continue
			}
			vendor := strings.TrimSpace(line[tab+1:])
			if vendor == "" {
				continue
			}
			cache[oui] = vendor
		}
	})
}

// suffixPattern drops the trailing legal-entity block plus surrounding
// punctuation. Two applications cover "Amazon Technologies Inc." →
// strip "Inc.", leaves "Amazon Technologies", second pass strips the
// "Technologies" suffix. Mirrors the TS shortVendor exactly so the
// same input produces the same shortened output across runtimes.
var suffixPattern = regexp.MustCompile(
	`(?i)[\s,]*(?:Technologies|Innovation|TECHNOLOGIES)?[\s,]*` +
		`(?:Inc\.?|LLC\.?|Ltd\.?|Limited|Corp(?:oration)?\.?|Co\.?,?\s*Ltd\.?|GmbH|S\.?A\.?|N\.?V\.?)` +
		`[\s.,]*$`,
)

var trailingPunct = regexp.MustCompile(`[\s.,]+$`)
var doubleSpace = regexp.MustCompile(`\s{2,}`)

// ShortVendor strips the legal-entity suffix block plus any trailing
// punctuation. "Apple, Inc." → "Apple", "Amazon Technologies Inc." →
// "Amazon", "Reolink Innovation Limited" → "Reolink". Direct port of
// shortVendor() in the TS mac-oui module so the topology view shows
// identical labels regardless of which runtime fed the data.
func ShortVendor(vendor string) string {
	out := suffixPattern.ReplaceAllString(vendor, "")
	out = suffixPattern.ReplaceAllString(out, "")
	out = trailingPunct.ReplaceAllString(out, "")
	out = doubleSpace.ReplaceAllString(out, " ")
	return strings.TrimSpace(out)
}

// resetCacheForTesting drops the cache so tests can verify the lazy-
// load semantics. Test-only; production never calls it.
func resetCacheForTesting() {
	once = sync.Once{}
	cache = nil
}
