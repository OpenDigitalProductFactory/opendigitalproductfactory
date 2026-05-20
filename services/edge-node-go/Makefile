# DPF Edge Node — Go native binary (Mode 4).
#
# Cross-compile targets ride on the Go toolchain's built-in
# GOOS/GOARCH matrix. No CGO so static linking is trivial.
#
# Version stamping: `make release VERSION=v0.1.0` injects the tag at
# link time via -ldflags. Dev builds without VERSION fall back to
# `0.0.0-dev` in main.go.

SHELL := /bin/sh
GO ?= go
LDFLAGS_VERSION = -X main.Version=$(VERSION)
BUILD_FLAGS = -trimpath -ldflags "-s -w $(LDFLAGS_VERSION)"
OUT_DIR ?= bin

.PHONY: help build test test-race vet fmt fmt-check tidy \
        build-linux-amd64 build-linux-arm64 \
        build-darwin-amd64 build-darwin-arm64 \
        build-windows-amd64 build-windows-arm64 \
        build-all clean

help:
	@echo "DPF Edge Node (Go) — common targets:"
	@echo "  make build               build for the host platform"
	@echo "  make test                go test ./..."
	@echo "  make test-race           go test -race ./..."
	@echo "  make vet                 go vet ./..."
	@echo "  make build-linux-amd64   cross-compile"
	@echo "  make build-darwin-arm64  cross-compile"
	@echo "  make build-windows-amd64 cross-compile"
	@echo "  make build-all           every supported (OS, ARCH) tuple"
	@echo "  make clean               remove ./bin/"

build:
	$(GO) build $(BUILD_FLAGS) -o $(OUT_DIR)/dpf-edge-node ./cmd/dpf-edge-node

test:
	$(GO) test ./...

test-race:
	$(GO) test -race ./...

vet:
	$(GO) vet ./...

fmt:
	$(GO) fmt ./...

fmt-check:
	@out=$$($(GO) fmt ./...); \
	if [ -n "$$out" ]; then \
	  echo "gofmt diffs found:"; echo "$$out"; exit 1; \
	fi

tidy:
	$(GO) mod tidy

# ─── Cross-compile targets ─────────────────────────────────────────────
# Output files include the OS+ARCH suffix so multiple targets can be
# built in parallel into the same bin/ directory. Windows targets get
# the .exe extension.

build-linux-amd64:
	GOOS=linux GOARCH=amd64 CGO_ENABLED=0 $(GO) build $(BUILD_FLAGS) \
	  -o $(OUT_DIR)/dpf-edge-node-linux-amd64 ./cmd/dpf-edge-node

build-linux-arm64:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 $(GO) build $(BUILD_FLAGS) \
	  -o $(OUT_DIR)/dpf-edge-node-linux-arm64 ./cmd/dpf-edge-node

build-darwin-amd64:
	GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 $(GO) build $(BUILD_FLAGS) \
	  -o $(OUT_DIR)/dpf-edge-node-darwin-amd64 ./cmd/dpf-edge-node

build-darwin-arm64:
	GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 $(GO) build $(BUILD_FLAGS) \
	  -o $(OUT_DIR)/dpf-edge-node-darwin-arm64 ./cmd/dpf-edge-node

build-windows-amd64:
	GOOS=windows GOARCH=amd64 CGO_ENABLED=0 $(GO) build $(BUILD_FLAGS) \
	  -o $(OUT_DIR)/dpf-edge-node-windows-amd64.exe ./cmd/dpf-edge-node

build-windows-arm64:
	GOOS=windows GOARCH=arm64 CGO_ENABLED=0 $(GO) build $(BUILD_FLAGS) \
	  -o $(OUT_DIR)/dpf-edge-node-windows-arm64.exe ./cmd/dpf-edge-node

build-all: build-linux-amd64 build-linux-arm64 \
           build-darwin-amd64 build-darwin-arm64 \
           build-windows-amd64 build-windows-arm64

clean:
	rm -rf $(OUT_DIR)
