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
  uv sync --locked
  uv run ruff check .
  uv run ruff format --check .
  uv run pytest
}

check_node() {
  npm ci
  npm run lint
  npm run typecheck
  npm test
  npm run build
}

scan() {
  trivy fs --quiet --skip-dirs .venv --skip-dirs node_modules --scanners vuln,secret --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .
  uvx --python 3.13 semgrep@1.185.0 scan --config p/default --error --quiet --metrics=off --no-git-ignore --exclude .venv --exclude node_modules .
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
    elif [ -f package.json ]; then
      check_node
    else
      echo "no known project file in $app" >&2
      exit 1
    fi
    actionlint .github/workflows/*.yml
    hadolint Dockerfile
    if [ "${RUN_SCANS:-}" = true ]; then
      scan
    else
      echo "scans skipped: set RUN_SCANS=true to run trivy and semgrep"
    fi
  )
done
