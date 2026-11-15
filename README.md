# backstage-templates

🇷🇺 [Русская версия](README_RUS.md)

Backstage scaffolder templates and repository skeletons for the [as-platform](https://github.com/as-platform) homelab platform, with CI/CD and security wired in.

> **Status: four templates, all run from the portal.** `back-go` was run from the [`backstage`](https://github.com/as-platform/backstage) portal on 2026-11-09 with the deploy option on and off. `back-python`, `front-react` and `monorepo` were run from the portal on 2026-11-15 with the deploy option on: each created a private repository, got a green CI with signed images in the registry, a bump of the image tag in `k3s`, an Application `Synced`/`Healthy` and an answer over HTTPS. For `monorepo` the selective build was checked too in three pushes: a change only in `services/web` built and deployed only the frontend, a change only in `services/api` only the API, a change only in a Markdown file nothing. **Not checked:** `back-go` after its CI moved to `skeletons/_shared/ci` (the rendered output is byte for byte the same and the shared file is exercised by the other templates, but the template itself was not run again), `monorepo` with a Python API (rendered and checked only), and the dry run of any template.

## Layout

```text
.
├── scaffolder
│   ├── back-go/template.yaml        # Go backend service
│   ├── back-python/template.yaml    # Python backend service (FastAPI)
│   ├── front-react/template.yaml    # React frontend (Vite, TypeScript)
│   └── monorepo/template.yaml       # API (Go or Python) and React frontend in one repository
├── skeletons
│   ├── back-go/                     # Go service skeleton
│   ├── back-python/                 # Python service skeleton
│   ├── front-react/                 # React skeleton and its static server
│   ├── monorepo/                    # root of the monorepo: ci.yml, README, catalog
│   ├── _shared/ci/                  # ci.yml and renovate.json shared by the service templates
│   └── _shared/platform-pr/         # values.yaml for the pull request to k3s
├── scripts                          # render.mjs, check-rendered.sh
└── tests                            # fixtures and npm test
```

## What every template does

**Steps:** render the skeleton → create the repository → give the repository access to the runner group → render `apps/<name>/values.yaml` → open a pull request in [`k3s`](https://github.com/as-platform/k3s) → register the component in the catalog. Rendering the values and opening the pull request run only when deploy to dev is on; the runner access and the registration always run. The runner access step calls the custom action `github:runner-group:add-repo` of the portal: without it the CI of a new private repository waits in the queue, because the runner group `Default` is limited to selected repositories.

**The form** asks for a name, a description, an owner (a catalog group) and deploy to dev (default on). The name becomes the repository, namespace, Argo CD Application and Helm release name: 3 to 32 characters (28 for `monorepo`), lowercase letters, digits and dashes. Names of platform components and their namespaces are rejected; `monorepo` also rejects `kube` and the catalog system `as-platform`. Repositories are always created private, because their CI runs on self-hosted runners.

**The generated service** listens on `:8080` with `/healthz` and `/readyz`, shuts down gracefully, and ships a Dockerfile on the golden images, `catalog-info.yaml`, a Renovate config and a CI workflow. The workflow calls the reusable workflows of [`ci-templates`](https://github.com/as-platform/ci-templates) (`@main`): language CI, a security scan (gitleaks, trivy, hadolint, semgrep), then image build, scan, push and cosign signature, then a bump of the image tag in `k3s`. Containers run as user `65532` on a read-only root filesystem, so the service must not write to disk.

## The templates

- **`back-go`**: Go standard library, `golangci-lint`, `go test -race`.
- **`back-python`**: FastAPI and uvicorn, `uv` with a committed `uv.lock`, `ruff`, `pytest`. The image installs the locked dependencies with `uv pip install --target` (no virtual environment: the interpreter paths differ between the build image and the distroless runtime) and has no compiler, so only packages with wheels work. The Application gets a memory limit of `256Mi`.
- **`front-react`**: Vite, React and TypeScript with `vitest`, `eslint` and `tsc`. There is no web server image, so the repository ships a small Node static server (`server/server.mjs`, standard library only, SPA fallback, `/healthz`, `/readyz`, no writes to disk) that runs on `golden/runtime:node`. `.npmrc` pins exact versions and waits seven days for new releases.
- **`monorepo`**: `services/api` (Go or Python, chosen in the form) and `services/web` (the React skeleton). Each service is its own image and its own Application (`<name>-api`, `<name>-web`) with its own namespace and host; one pull request in `k3s` adds both. The CI builds and deploys only the services whose files changed: a change outside `services/*` selects both, a change to Markdown files only selects none. The services do not talk to each other out of the box. The catalog gets one System and two Components.

Postponed: the `as-skill` harness option in the form.

## Checks

```text
npm ci
npm test                  # schema, form rules, rendered output of eight fixtures
npm run render -- back-go-full
npm run check:rendered    # lint, tests, build, actionlint, hadolint on every rendered project
RUN_SCANS=true npm run check:rendered   # adds trivy and semgrep
```

`check:rendered` renders every fixture and runs the checks of its language: `gofmt`, `go vet`, `go test -race` and `golangci-lint` for Go, `uv sync --locked`, `ruff` and `pytest` for Python, `npm ci`, lint, typecheck, tests and build for Node. Every Dockerfile goes through `hadolint`, every workflow through `actionlint`. It needs `go`, `golangci-lint`, `uv`, `node`, `actionlint` and `hadolint` on `PATH`, plus `trivy` and `uvx` for the scans. The CI of this repository runs it on a GitHub-hosted runner; the scans run there every Monday and on manual dispatch, so a new vulnerability in a lock file shows up as a red weekly run, not as a red push. `golangci-lint`, `actionlint`, `hadolint` and `trivy` are pinned by version and sha256 in `.github/workflows/ci.yml`, `uv` by version there, `semgrep` by version in `scripts/check-rendered.sh`; all of them are bumped by hand; Renovate handles the actions and the npm packages but ignores `skeletons/**`, so the lock files of the skeletons (`uv.lock`, `package-lock.json`) are refreshed by hand too. The image tag bump test keeps a copy of the `awk` script from `ci-templates/actions/bump-image-tag`; change both together.

The tests also reject comments and lint suppressions in the rendered files, scanner ignore files in the skeletons and any file skipped because an earlier step already wrote it. `scripts/render.mjs` mirrors `fetch:template` of the portal (skipping existing files, `copyWithoutTemplating`, binary files, file modes).

## After the template creates a service

The new repository needs its own variable and secrets: organization-level ones are not available to private repositories on the Free plan. The variable `ZOT_REGISTRY` is set by the template.

```text
gh variable set ZOT_REGISTRY --body zot.homelab -R as-platform/<name>
gh secret set ZOT_USER -R as-platform/<name>
gh secret set ZOT_PASSWORD -R as-platform/<name>
gh secret set COSIGN_PRIVATE_KEY -R as-platform/<name> < cosign.key
gh secret set COSIGN_PASSWORD -R as-platform/<name>
gh secret set PLATFORM_TOKEN -R as-platform/<name>
```

`PLATFORM_TOKEN` is a fine-grained personal access token limited to the `k3s` repository with `Contents: Read and write`. It lets the CI of the service commit the new image tag. If the token is rejected (`Invalid username or token` in the `deploy` job), it has expired or was not approved by the organization.

GitHub fixes the values of the secrets when a run is created. The first push to the new repository starts a run before the secrets exist, so set the secrets, wait until that run has finished (or cancel it), and only then re-run it with `gh run rerun <id> --failed`. Re-running while the run is still going is refused, and a job that starts after you set the secrets still sees them empty.

First deploy:

1. Do not merge the pull request in `k3s` yet.
2. After the re-run `go`, `python` or `node`, `security` and `image` go green. `deploy` fails with `values.yaml not found`, as the file is not in `k3s` yet.
3. Merge the pull request. The Application is `Degraded` (`ImagePullBackOff` on the placeholder tag `bootstrap`) until the next step.
4. Re-run the `deploy` job: it commits the real tag, Argo CD syncs (it polls Git every few minutes), and the service answers on `https://<name>.homelab`. Add `<name>.homelab` to `/etc/hosts` next to the other `*.homelab` entries. For `monorepo` there are two jobs (`deploy-api`, `deploy-web`) and two names, `<name>-api.homelab` and `<name>-web.homelab`.

After deleting a service repository, remove `apps/<name>` from `k3s` too: a stale directory is silently overwritten by the pull request of a new service with the same name. The derived names of a monorepo (`<name>-api`, `<name>-web`) are not protected by the uniqueness of repository names either.

## Not done yet

- The dry run of the templates. The templates take their skeletons from outside their own folder, which the Template Editor does not see.
- The repository secrets are still a manual step: the portal does not hold the registry password or the signing key. The plan is to stop using repository secrets and let the CI read them from OpenBao with a GitHub OIDC token (not started).
- The `as-skill` harness option in the form (postponed).
- A structural protection against name collisions between services (a prefix in the Application name of the `apps` ApplicationSet): only the list of reserved names works today.
- The form rejects a reserved name with the generic message `'Name' must NOT be valid`; the field description explains that platform names are reserved.

## Related repositories

- [`backstage`](https://github.com/as-platform/backstage) — the portal that reads these templates
- [`ci-templates`](https://github.com/as-platform/ci-templates) — the reusable workflows that generated repositories call
- [`k3s`](https://github.com/as-platform/k3s) — the GitOps repository that receives the deployment PR

## License

MIT — see [`LICENSE`](LICENSE).
