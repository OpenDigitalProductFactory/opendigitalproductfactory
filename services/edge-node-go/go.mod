module github.com/opendigitalproductfactory/dpf/services/edge-node-go

// We target Go 1.24 as the floor so we can rely on log/slog (1.21+),
// fs.PathError (1.20+), and the math/rand/v2 conveniences (1.22+).
// Newer Go is fine; CI tests at 1.24 to keep the LTS floor honest.
go 1.24
