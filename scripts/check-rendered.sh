#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

for fixture in tests/fixtures/*.json; do
  node scripts/render.mjs "$(basename "$fixture" .json)"
done

for app in out/*/app; do
  echo "== $app"
  (
    cd "$app"
    test -z "$(gofmt -l .)"
    go vet ./...
    go test -race ./...
    golangci-lint run
    actionlint .github/workflows/*.yml
    hadolint Dockerfile
  )
done
