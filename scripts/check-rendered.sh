#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

check_go() {
  test -z "$(gofmt -l .)"
  go vet ./...
  go test -race ./...
  golangci-lint run
}

check_python() {
  uv sync --frozen
  uv run ruff check .
  uv run ruff format --check .
  uv run pytest
}

scan() {
  if command -v trivy >/dev/null 2>&1; then
    trivy fs --quiet --skip-dirs .venv --scanners vuln,secret --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .
  else
    echo "trivy not found, skipping the vulnerability scan"
  fi
}

for fixture in tests/fixtures/*.json; do
  node scripts/render.mjs "$(basename "$fixture" .json)"
done

for app in out/*/app; do
  echo "== $app"
  (
    cd "$app"
    if [ -f go.mod ]; then
      check_go
    elif [ -f pyproject.toml ]; then
      check_python
    else
      echo "no known project file in $app" >&2
      exit 1
    fi
    actionlint .github/workflows/*.yml
    hadolint Dockerfile
    scan
  )
done
