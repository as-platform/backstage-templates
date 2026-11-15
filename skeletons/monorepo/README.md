# ${{ values.name }}

${{ values.description }}

Owner: `${{ values.owner }}`

## Layout

| Path | Service | Image | Host |
|------|---------|-------|------|
| `services/api` | API in ${{ values.apiLanguage }} | `zot.homelab/apps/${{ values.name }}-api` | `${{ values.name }}-api.homelab` |
| `services/web` | React frontend | `zot.homelab/apps/${{ values.name }}-web` | `${{ values.name }}-web.homelab` |

Each service has its own README with the endpoints and the local run instructions. The services are independent: the frontend has no API address and the chart has no environment settings, so nothing connects them out of the box. Each service is a separate Argo CD Application with its own namespace, image and host.

## CI

`.github/workflows/ci.yml` calls reusable workflows from `as-platform/ci-templates` (`@main`):

- `test`: runs the CI of the language only for the services whose files changed. A change outside `services/*` (shared files) selects both services, a change to `*.md` files only selects none.
- `security`: gitleaks, trivy, hadolint, semgrep for the whole repository.
- `image-api` and `image-web` (after `test` and `security`, only for a changed service): build the image with buildah, scan it with trivy, and on push to `main` push it to `zot.homelab/apps/${{ values.name }}-api` or `-web` as `sha-<7 chars>` and sign it with cosign.
{%- if values.deployDev %}
- `deploy-api` and `deploy-web` (push to `main` only, after the image of that service): set `image.tag` in `apps/${{ values.name }}-api/values.yaml` or `apps/${{ values.name }}-web/values.yaml` of `as-platform/k3s`, Argo CD syncs the change.
{%- endif %}

The first push to `main` selects both services. Both images get the same tag `sha-<7 chars>`.

Every push is compared with the previous one, so a service that was not touched by a push is not rebuilt. If a run fails, re-run it: a later push that does not change the failed service will not build it again. Push runs never cancel each other, so no build is lost. If two pushes to the same service overlap, the run that finishes last sets the tag, so re-run `deploy-api` or `deploy-web` of the latest run.

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

The initial push runs CI before the secrets exist and fails. GitHub fixes the secret values when a run is created, so set the secrets, wait until that run has finished (or cancel it) and only then re-run it with `gh run rerun <id> --failed`; a job that starts after you set the secrets still sees them empty.
{%- if values.deployDev %}

## First deploy

1. The template opens one pull request in `as-platform/k3s` that adds `apps/${{ values.name }}-api/values.yaml` and `apps/${{ values.name }}-web/values.yaml` with `tag: "bootstrap"`. Do not merge it yet.
2. After the secrets are set, a push to `main` turns `test`, `security`, `image-api` and `image-web` green. `deploy-api` and `deploy-web` fail with `values.yaml not found`: the files are not in `k3s` yet.
3. Merge the pull request. Both Applications stay `Degraded` (`ImagePullBackOff` on `bootstrap`) until the next step.
4. Re-run the failed `deploy-api` and `deploy-web` jobs. They commit the real tags to `k3s`, Argo CD syncs, and the services answer on `https://${{ values.name }}-api.homelab` and `https://${{ values.name }}-web.homelab` (add both names to `/etc/hosts` next to the other `*.homelab` entries).
{%- endif %}
