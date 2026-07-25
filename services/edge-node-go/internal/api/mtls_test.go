package api

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNewMutualTLSHTTPClientPresentsConfiguredMachineCertificate(t *testing.T) {
	now := time.Now().UTC()
	rootCert, rootKey, rootPEM, _ := issueTestCertificate(t, nil, nil, pkix.Name{CommonName: "test root"}, nil, true, nil, now)
	_, _, serverPEM, serverKeyPEM := issueTestCertificate(t, rootCert, rootKey, pkix.Name{CommonName: "localhost"}, []string{"localhost"}, false, []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, now)
	_, _, clientPEM, clientKeyPEM := issueTestCertificate(t, rootCert, rootKey, pkix.Name{CommonName: "dpf-edge-test"}, nil, false, []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}, now)

	dir := t.TempDir()
	caPath := writeTestPEM(t, dir, "root.crt", rootPEM)
	certPath := writeTestPEM(t, dir, "client.crt", clientPEM)
	keyPath := writeTestPEM(t, dir, "client.key", clientKeyPEM)

	pool := x509.NewCertPool()
	pool.AddCert(rootCert)
	seenPeer := false
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPeer = len(r.TLS.PeerCertificates) == 1 && r.TLS.PeerCertificates[0].Subject.CommonName == "dpf-edge-test"
		w.WriteHeader(http.StatusNoContent)
	}))
	server.TLS = &tls.Config{
		Certificates: []tls.Certificate{mustTLSCertificate(t, serverPEM, serverKeyPEM)},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    pool,
	}
	server.StartTLS()
	defer server.Close()

	hc, err := NewMutualTLSHTTPClient(MutualTLSOptions{CAFile: caPath, CertFile: certPath, KeyFile: keyPath, Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	serverURL := strings.Replace(server.URL, "127.0.0.1", "localhost", 1)
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, serverURL, nil)
	resp, err := hc.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if !seenPeer {
		t.Fatal("server did not receive the configured machine certificate")
	}
}

func issueTestCertificate(t *testing.T, parent *x509.Certificate, parentKey ed25519.PrivateKey, subject pkix.Name, dns []string, isCA bool, usages []x509.ExtKeyUsage, now time.Time) (*x509.Certificate, ed25519.PrivateKey, []byte, []byte) {
	t.Helper()
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(now.UnixNano()), Subject: subject, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(time.Hour), DNSNames: dns, IsCA: isCA, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: usages}
	if isCA {
		tmpl.KeyUsage |= x509.KeyUsageCertSign
	}
	if parent == nil {
		parent, parentKey = tmpl, key
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, parent, pub, parentKey)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: mustPKCS8(t, key)})
	return cert, key, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), keyPEM
}

func mustPKCS8(t *testing.T, key ed25519.PrivateKey) []byte {
	t.Helper()
	b, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func mustTLSCertificate(t *testing.T, cert, key []byte) tls.Certificate {
	t.Helper()
	pair, err := tls.X509KeyPair(cert, key)
	if err != nil {
		t.Fatal(err)
	}
	return pair
}
func writeTestPEM(t *testing.T, dir, name string, body []byte) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, body, 0600); err != nil {
		t.Fatal(err)
	}
	return path
}
