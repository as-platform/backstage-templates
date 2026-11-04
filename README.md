# backstage-templates

🇷🇺 [Русская версия](README_RUS.md)

Backstage scaffolder templates and repository skeletons for the [as-platform](https://github.com/as-platform) homelab platform, with CI/CD and security wired in.

> **Status: skeleton.** The four `template.yaml` files are empty and `skeletons/` contains only `.gitkeep`. Nothing here can be run yet; the sections below describe the plan.

## Layout

```text
.
├── scaffolder
│   ├── back-go/template.yaml        # Go backend (empty)
│   ├── back-python/template.yaml    # Python backend (empty)
│   ├── front-react/template.yaml    # React frontend (empty)
│   └── monorepo/template.yaml       # monorepo (empty)
└── skeletons/                       # repository skeletons (only .gitkeep so far)
```

## Plan

- **Skeletons:** `skeletons/<type>` for each template, plus the shared parts in `skeletons/_shared/{harness,ci,security,platform-pr}`.
- **Form:** name, owner, language, harness (the [`as-skill`](https://github.com/alexeyshishin/as-skill) domains), security, nightly shutdown, deploy to dev.
- **Steps:** skeleton → harness → CI/security → repository creation → PR to `k3s` → registration in the catalog.

## Related repositories

- [`backstage`](https://github.com/as-platform/backstage) — the portal that reads these templates
- [`ci-templates`](https://github.com/as-platform/ci-templates) — the reusable workflows that generated repositories call
- [`k3s`](https://github.com/as-platform/k3s) — the GitOps repository that receives the deployment PR

## License

MIT — see [`LICENSE`](LICENSE).
