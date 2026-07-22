package api

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"
)

type MutualTLSOptions struct {
	CAFile   string
	CertFile string
	KeyFile  string
	Timeout  time.Duration
}

// NewMutualTLSHTTPClient builds the action-channel transport from host-mounted
// trust files. It never falls back to system roots or a bearer-only client.
func NewMutualTLSHTTPClient(opts MutualTLSOptions) (*http.Client, error) {
	if opts.CAFile == "" || opts.CertFile == "" || opts.KeyFile == "" {
		return nil, errors.New("CAFile, CertFile, and KeyFile are required for mutual TLS")
	}
	rootPEM, err := os.ReadFile(opts.CAFile)
	if err != nil {
		return nil, fmt.Errorf("read Edge action CA: %w", err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(rootPEM) {
		return nil, errors.New("Edge action CA file contains no certificates")
	}
	certificate, err := tls.LoadX509KeyPair(opts.CertFile, opts.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("load Edge action client certificate: %w", err)
	}
	timeout := opts.Timeout
	if timeout == 0 {
		timeout = defaultTimeout
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{
		MinVersion:   tls.VersionTLS13,
		RootCAs:      roots,
		Certificates: []tls.Certificate{certificate},
	}
	return &http.Client{Transport: transport, Timeout: timeout}, nil
}
