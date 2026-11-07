# backstage-templates

🇷🇺 [Русская версия](README_RUS.md)

Backstage scaffolder templates and repository skeletons for the [as-platform](https://github.com/as-platform) homelab platform, with CI/CD and security wired in.

> **Status: one template works, the portal is not there yet.** `back-go` is verified end to end without Backstage: a service rendered from it builds in CI, lands in the registry as a signed image and runs in the cluster behind HTTPS. It has not been run inside Backstage itself (the [`backstage`](https://github.com/as-platform/backstage) portal is still a skeleton), so the `publish:github`, `publish:github:pull-request` and `catalog:register` steps are unverified. `back-python`, `front-react` and `monorepo` are empty.

## Layout

```text
.
├── scaffolder
│   ├── back-go/template.yaml        # Go backend service (working)
│   ├── back-python/template.yaml    # Python backend (empty)
│   ├── front-react/template.yaml    # React frontend (empty)
│   └── monorepo/template.yaml       # monorepo (empty)
├── skeletons
│   ├── back-go/                     # Go service skeleton
│   └── _shared/platform-pr/         # values.yaml for the pull request to k3s
├── scripts                          # render.mjs, check-rendered.sh
└── tests                            # fixtures and npm test
```

## The `back-go` template

**Form:** name, description, owner (a catalog group), deploy to dev (default on).

- The name becomes the repository, namespace, Argo CD Application and Helm release name: 3 to 32 characters, lowercase letters, digits and dashes. Names of platform components and their namespaces are rejected.
- Repositories are always created private, because their CI runs on self-hosted runners.

**Steps:** render the skeleton → create the repository → render `apps/<name>/values.yaml` → open a pull request in [`k3s`](https://github.com/as-platform/k3s) → register the component in the catalog. Rendering the values and opening the pull request run only when deploy to dev is on; the registration always runs.

**The generated service** listens on `:8080` with `/healthz` and `/readyz`, shuts down gracefully, and ships a Dockerfile on the golden images, `catalog-info.yaml`, a Renovate config and a CI workflow. The workflow calls the reusable workflows of [`ci-templates`](https://github.com/as-platform/ci-templates) (`@main`): Go lint and tests, a security scan (gitleaks, trivy, hadolint, semgrep), then image build, scan, push and cosign signature, then a bump of the image tag in `k3s`.

## Checks

```text
npm ci
npm test                  # template schema, form rules, rendered output of two fixtures
npm run render -- back-go-full
npm run check:rendered    # go vet, tests, golangci-lint, actionlint, hadolint on rendered projects
```

`check:rendered` needs `go`, `golangci-lint`, `actionlint` and `hadolint` on `PATH`. The CI of this repository runs the same on a GitHub-hosted runner. The versions and sha256 sums of those four tools are pinned in `.github/workflows/ci.yml` and bumped by hand; Renovate handles the actions and the npm packages. The image tag bump test keeps a copy of the `awk` script from `ci-templates/actions/bump-image-tag`; change both together.

## After the template creates a service

The new repository needs its own variable and secrets: organization-level ones are not available to private repositories on the Free plan.

```text
gh variable set ZOT_REGISTRY --body zot.homelab -R as-platform/<name>
gh secret set ZOT_USER -R as-platform/<name>
gh secret set ZOT_PASSWORD -R as-platform/<name>
gh secret set COSIGN_PRIVATE_KEY -R as-platform/<name> < cosign.key
gh secret set COSIGN_PASSWORD -R as-platform/<name>
gh secret set PLATFORM_TOKEN -R as-platform/<name>
```

`PLATFORM_TOKEN` is a fine-grained personal access token limited to the `k3s` repository with `Contents: Read and write`. It lets the CI of the service commit the new image tag.

First deploy:

1. Do not merge the pull request in `k3s` yet. The first push to the new repository fails before the secrets exist: set them, then re-run the workflow.
2. `go`, `security` and `image` go green. `deploy` fails with `values.yaml not found`, as the file is not in `k3s` yet.
3. Merge the pull request. The Application is `Degraded` (`ImagePullBackOff` on the placeholder tag `bootstrap`) until the next step.
4. Re-run the `deploy` job: it commits the real tag, Argo CD syncs, and the service answers on `https://<name>.homelab`. Add `<name>.homelab` to `/etc/hosts` next to the other `*.homelab` entries.

## Not done yet

- Running the template in Backstage (dry run, the GitHub integration, a custom action that sets the repository secrets).
- The other three templates, the `as-skill` harness option in the form, and the shared `_shared/{harness,ci}` parts: the CI lives in the `back-go` skeleton until a second template needs it.
- The output link to the `k3s` pull request when deploy to dev is off points at a skipped step; check it on the first dry run.

## Related repositories

- [`backstage`](https://github.com/as-platform/backstage) — the portal that reads these templates
- [`ci-templates`](https://github.com/as-platform/ci-templates) — the reusable workflows that generated repositories call
- [`k3s`](https://github.com/as-platform/k3s) — the GitOps repository that receives the deployment PR

## License

MIT — see [`LICENSE`](LICENSE).
