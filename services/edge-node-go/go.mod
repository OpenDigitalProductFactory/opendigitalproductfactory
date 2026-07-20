module github.com/opendigitalproductfactory/dpf/services/edge-node-go

// We target Go 1.24 as the floor so we can rely on log/slog (1.21+),
// fs.PathError (1.20+), and the math/rand/v2 conveniences (1.22+).
// Newer Go is fine; CI tests at 1.24 to keep the LTS floor honest.
go 1.25.0

require (
	github.com/betamos/zeroconf v0.1.7
	github.com/google/uuid v1.6.0
	golang.org/x/sys v0.45.0
)

require (
	github.com/miekg/dns v1.1.62 // indirect
	golang.org/x/mod v0.22.0 // indirect
	golang.org/x/net v0.55.0 // indirect
	golang.org/x/sync v0.10.0 // indirect
	golang.org/x/tools v0.29.0 // indirect
)
