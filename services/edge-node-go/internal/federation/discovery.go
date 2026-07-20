// Package federation owns the privacy boundary for nearby DPF discovery.
// DNS-SD records are untrusted setup suggestions; they never establish trust.
package federation

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const PairPath = "/connect/pair"

// ServiceRecord is the dependency-neutral result of resolving one DNS-SD
// service. The network adapter can change without weakening this parser.
type ServiceRecord struct {
	Host string
	Port int
	TXT  []string
}

// Candidate is safe to submit to the Authority Core. It deliberately carries
// no service instance, hostname-derived identity, organization, or token.
type Candidate struct {
	DiscoveryID      string `json:"discoveryId"`
	Endpoint         string `json:"endpoint"`
	Protocol         string `json:"protocol"`
	CapabilityDigest string `json:"capabilityDigest"`
	PairPath         string `json:"pairPath"`
}

// AdvertisementTXT returns the complete closed TXT allow-list.
func AdvertisementTXT(discoveryID, capabilityDigest, scheme string) []string {
	return []string{
		"protocol=1",
		"install=" + discoveryID,
		"caps=" + capabilityDigest,
		"pair=" + PairPath,
		"scheme=" + scheme,
	}
}

// RotatingDiscoveryID derives an unlinkable, window-scoped public identifier
// from an installation-local secret. The secret never enters DNS-SD.
func RotatingDiscoveryID(secret []byte, now time.Time, window time.Duration) string {
	if window <= 0 {
		window = 15 * time.Minute
	}
	bucket := now.Unix() / int64(window/time.Second)
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(strconv.FormatInt(bucket, 10)))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil)[:12])
}

// ParseService enforces the TXT privacy allow-list and produces an HTTP or
// HTTPS candidate. Discovery is secret-free; pairing separately requires TLS.
func ParseService(record ServiceRecord) (Candidate, error) {
	if record.Port < 1 || record.Port > 65535 {
		return Candidate{}, errors.New("service port is outside 1..65535")
	}
	values := make(map[string]string, len(record.TXT))
	allowed := map[string]bool{"protocol": true, "install": true, "caps": true, "pair": true, "scheme": true}
	for _, raw := range record.TXT {
		key, value, ok := strings.Cut(raw, "=")
		if !ok || !allowed[key] || value == "" {
			return Candidate{}, fmt.Errorf("unexpected or malformed TXT value %q", raw)
		}
		if _, duplicate := values[key]; duplicate {
			return Candidate{}, fmt.Errorf("duplicate TXT key %q", key)
		}
		values[key] = value
	}
	if len(values) != 5 || values["protocol"] != "1" || values["pair"] != PairPath {
		return Candidate{}, errors.New("unsupported or incomplete DPF federation service")
	}
	if values["scheme"] != "http" && values["scheme"] != "https" {
		return Candidate{}, errors.New("unsupported DPF federation endpoint scheme")
	}
	host := strings.TrimSuffix(strings.TrimSpace(record.Host), ".")
	if host == "" || strings.ContainsAny(host, "/?#@") {
		return Candidate{}, errors.New("invalid service host")
	}
	endpoint := (&url.URL{
		Scheme: values["scheme"],
		Host:   net.JoinHostPort(host, strconv.Itoa(record.Port)),
	}).String()
	return Candidate{
		DiscoveryID:      values["install"],
		Endpoint:         endpoint,
		Protocol:         values["protocol"],
		CapabilityDigest: values["caps"],
		PairPath:         values["pair"],
	}, nil
}
