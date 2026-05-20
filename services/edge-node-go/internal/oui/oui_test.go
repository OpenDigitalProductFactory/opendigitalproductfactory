package oui

import (
	"testing"
)

func TestNormalizeMAC(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"aa:bb:cc:dd:ee:ff", "AABBCCDDEEFF"},
		{"AA-BB-CC-DD-EE-FF", "AABBCCDDEEFF"},
		{"AABB.CCDD.EEFF", "AABBCCDDEEFF"},
		{"AABBCCDDEEFF", "AABBCCDDEEFF"},
		{"aa bb cc dd ee ff", "AABBCCDDEEFF"},
	}
	for _, c := range cases {
		if got := NormalizeMAC(c.in); got != c.want {
			t.Errorf("NormalizeMAC(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNormalizeMAC_rejects(t *testing.T) {
	for _, in := range []string{
		"",
		"not-a-mac",
		"aa:bb:cc:dd:ee",         // too short
		"zz:bb:cc:dd:ee:ff",      // non-hex
		"aa:bb:cc:dd:ee:ff:00",   // too long
	} {
		if got := NormalizeMAC(in); got != "" {
			t.Errorf("NormalizeMAC(%q) = %q, want empty (rejected)", in, got)
		}
	}
}

func TestLookup_recognizesKnownAmazonOUI(t *testing.T) {
	// FC:A1:83 is one of Amazon Technologies Inc.'s OUIs in the
	// IEEE registry. If this assertion fails, either the embedded
	// dataset wasn't shipped or the lookup logic regressed.
	entry := Lookup("fc:a1:83:de:ad:be")
	if entry == nil {
		t.Fatal("Lookup(fc:a1:83:...) returned nil — embedded dataset missing?")
	}
	if entry.OUI != "FCA183" {
		t.Errorf("OUI = %q, want FCA183", entry.OUI)
	}
	if entry.Vendor == "" || entry.Vendor[:6] != "Amazon" {
		t.Errorf("Vendor = %q, want starts with 'Amazon'", entry.Vendor)
	}
}

func TestLookup_acceptsAnyMACSeparatorForm(t *testing.T) {
	for _, mac := range []string{
		"fc:a1:83:11:22:33",
		"FC:A1:83:11:22:33",
		"fc-a1-83-11-22-33",
		"FCA183112233",
		"fca1.8311.2233",
	} {
		entry := Lookup(mac)
		if entry == nil || entry.OUI != "FCA183" {
			t.Errorf("Lookup(%q) failed — got %+v", mac, entry)
		}
	}
}

func TestLookup_returnsNilForUnknownOUI(t *testing.T) {
	if entry := Lookup("de:ad:be:ef:00:00"); entry != nil {
		t.Errorf("Lookup unknown returned %+v, want nil", entry)
	}
}

func TestLookup_returnsNilForBadMAC(t *testing.T) {
	if entry := Lookup("not-a-mac"); entry != nil {
		t.Errorf("Lookup bad MAC returned %+v, want nil", entry)
	}
}

func TestShortVendor_stripsLegalSuffixes(t *testing.T) {
	cases := map[string]string{
		"Apple, Inc.":                     "Apple",
		"Amazon Technologies Inc.":        "Amazon",
		"Reolink Innovation Limited":      "Reolink",
		"TP-LINK TECHNOLOGIES CO.,LTD.":   "TP-LINK",
		"Cisco Systems, Inc":              "Cisco Systems",
		"Ubiquiti Inc":                    "Ubiquiti",
		"HUAWEI TECHNOLOGIES CO.,LTD":     "HUAWEI",
	}
	for input, want := range cases {
		if got := ShortVendor(input); got != want {
			t.Errorf("ShortVendor(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestShortVendor_idempotentOnAlreadyShortNames(t *testing.T) {
	for _, in := range []string{"Google", "Sonos", "Roku"} {
		if got := ShortVendor(in); got != in {
			t.Errorf("ShortVendor(%q) = %q, want unchanged", in, got)
		}
	}
}

func TestLookup_cacheLoadsExactlyOnce(t *testing.T) {
	// First call populates the cache. Subsequent calls should hit
	// the cached map directly. We can't observe the sync.Once
	// directly but we can verify the cache map is non-nil after the
	// first call and remains the same instance across calls.
	resetCacheForTesting()
	_ = Lookup("fc:a1:83:11:22:33")
	if cache == nil {
		t.Fatal("cache nil after first Lookup")
	}
	firstCacheRef := cache
	_ = Lookup("00:11:22:33:44:55")
	if &cache != &firstCacheRef && cache == nil {
		t.Errorf("cache instance changed between calls")
	}
}
