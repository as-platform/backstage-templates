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

check_project() {
  if [ -f go.mod ]; then
    check_go
  elif [ -f pyproject.toml ]; then
    check_python
  elif [ -f package.json ]; then
    check_node
  else
    echo "no known project file in $(pwd)" >&2
    exit 1
  fi
}

scan() {
  trivy fs --quiet --skip-dirs '**/.venv' --skip-dirs '**/node_modules' --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .
  uvx --python 3.13 semgrep@1.185.0 scan --config p/default --error --quiet --metrics=off --no-git-ignore --exclude .venv --exclude node_modules .
}

for fixture in tests/fixtures/*.json; do
  node scripts/render.mjs "$(basename "$fixture" .json)"
done

for app in out/*/app; do
  echo "== $app"
  (
    cd "$app"
    if [ -d services ]; then
      for service in services/*/; do
        echo "-- $service"
        (cd "$service" && check_project)
      done
    else
      check_project
    fi
    actionlint .github/workflows/*.yml
    find . -name Dockerfile -not -path '*/node_modules/*' -not -path '*/.venv/*' -print0 | xargs -0 hadolint
    if [ "${RUN_SCANS:-}" = true ]; then
      scan
    else
      echo "scans skipped: set RUN_SCANS=true to run trivy and semgrep"
    fi
  )
done
