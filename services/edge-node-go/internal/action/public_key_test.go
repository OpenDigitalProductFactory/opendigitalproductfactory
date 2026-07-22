package action

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadPublicKeyAcceptsOnlyEd25519AuthorityKey(t *testing.T) {
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	path := writePublicKeyFixture(t, publicKey)
	loaded, err := LoadPublicKey(path)
	if err != nil {
		t.Fatal(err)
	}
	if !loaded.Equal(publicKey) {
		t.Fatal("loaded public key differs")
	}

	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := LoadPublicKey(writePublicKeyFixture(t, &rsaKey.PublicKey)); err == nil {
		t.Fatal("RSA action-signing key was accepted")
	}
}

func writePublicKeyFixture(t *testing.T, publicKey any) string {
	t.Helper()
	der, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "action-signing-public.pem")
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}
