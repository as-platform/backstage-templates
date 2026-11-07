# ${{ values.name }}

${{ values.description }}

Owner: `${{ values.owner }}`

## Endpoints

| Method | Path | Response |
|--------|------|----------|
| GET | `/` | 200, `{"service":"${{ values.name }}"}` |
| GET | `/healthz` | 200 |
| GET | `/readyz` | 200 |

Unknown paths return 404, other methods on known paths return 405.

## Local run

```
go run .
PORT=9090 go run .
go test -race ./...
golangci-lint run
```

The server listens on `PORT` (default `8080`) and shuts down gracefully on `SIGTERM` and `SIGINT`.

## Image

Base images come from `zot.homelab`: it needs an `/etc/hosts` entry, the `homelab-ca` certificate in `~/.docker/certs.d/zot.homelab/ca.crt` and `docker login zot.homelab`. The images are `linux/amd64`, so on Apple Silicon pass the platform explicitly:

```
docker build --platform linux/amd64 -t ${{ values.name }}:local .
docker run --rm --platform linux/amd64 --read-only --user 65532:65532 -p 8080:8080 ${{ values.name }}:local
```

## CI

`.github/workflows/ci.yml` calls reusable workflows from `as-platform/ci-templates` (`@main`):

- `go`: golangci-lint, tests, build.
- `security`: gitleaks, trivy, hadolint, semgrep.
- `image` (after `go` and `security`): builds the image with buildah, scans it with trivy, and on push to `main` pushes it to `zot.homelab/apps/${{ values.name }}:sha-<7 chars>` and signs it with cosign.
{%- if values.deployDev %}
- `deploy` (push to `main` only): sets `image.tag` in `apps/${{ values.name }}/values.yaml` of `as-platform/k3s`, Argo CD syncs the change.
{%- endif %}

Org-level secrets and variables are not available to private repositories on the Free plan, so set them on this repository:

```
gh variable set ZOT_REGISTRY --body zot.homelab -R as-platform/${{ values.name }}
gh secret set ZOT_USER -R as-platform/${{ values.name }}
gh secret set ZOT_PASSWORD -R as-platform/${{ values.name }}
gh secret set COSIGN_PRIVATE_KEY -R as-platform/${{ values.name }}
gh secret set COSIGN_PASSWORD -R as-platform/${{ values.name }}
{%- if values.deployDev %}
gh secret set PLATFORM_TOKEN -R as-platform/${{ values.name }}
{%- endif %}
```

The initial push runs CI before the secrets exist and fails: set them, then re-run the workflow.
{%- if values.deployDev %}

## First deploy

1. The template opens a pull request in `as-platform/k3s` that adds `apps/${{ values.name }}/values.yaml` with `tag: "bootstrap"`. Do not merge it yet.
2. After the secrets are set, a push to `main` turns `go`, `security` and `image` green. `deploy` fails with `values.yaml not found`: the file is not in `k3s` yet.
3. Merge the pull request. The Application stays `Degraded` (`ImagePullBackOff` on `bootstrap`) until the next step.
4. Re-run the `deploy` job. It commits the real tag to `k3s`, Argo CD syncs, and the service answers on `https://${{ values.name }}.homelab` (add `${{ values.name }}.homelab` to `/etc/hosts` next to the other `*.homelab` entries).
{%- endif %}
