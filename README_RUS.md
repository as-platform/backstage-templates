# backstage-templates

🇬🇧 [English version](README.md)

Шаблоны scaffolder Backstage и скелеты репозиториев для домашней платформы [as-platform](https://github.com/as-platform) с подключёнными CI/CD и security.

> **Статус: один шаблон работает, портала пока нет.** `back-go` проверен сквозным прогоном без Backstage: сервис из него собирается в CI, попадает в реестр подписанным образом и работает в кластере за HTTPS. Внутри самого Backstage он не запускался (портал [`backstage`](https://github.com/as-platform/backstage) пока каркас), поэтому шаги `publish:github`, `publish:github:pull-request` и `catalog:register` не проверены. `back-python`, `front-react` и `monorepo` пустые.

## Структура

```text
.
├── scaffolder
│   ├── back-go/template.yaml        # бэкенд-сервис на Go (работает)
│   ├── back-python/template.yaml    # бэкенд на Python (пусто)
│   ├── front-react/template.yaml    # фронтенд на React (пусто)
│   └── monorepo/template.yaml       # монорепозиторий (пусто)
├── skeletons
│   ├── back-go/                     # скелет Go-сервиса
│   └── _shared/platform-pr/         # values.yaml для PR в k3s
├── scripts                          # render.mjs, check-rendered.sh
└── tests                            # фикстуры и npm test
```

## Шаблон `back-go`

**Форма:** имя, описание, владелец (группа каталога), деплой в dev (по умолчанию включён).

- Имя становится именем репозитория, namespace, Application в Argo CD и релиза Helm: от 3 до 32 символов, строчные буквы, цифры и дефисы. Имена компонентов платформы и их namespace отклоняются.
- Репозитории всегда создаются приватными: их CI идёт на self-hosted раннерах.

**Шаги:** рендер скелета → создание репозитория → рендер `apps/<имя>/values.yaml` → PR в [`k3s`](https://github.com/as-platform/k3s) → регистрация компонента в каталоге. Рендер values и PR выполняются только при включённом деплое в dev, регистрация идёт всегда.

**Созданный сервис** слушает `:8080`, отдаёт `/healthz` и `/readyz`, корректно завершается и приходит с Dockerfile на golden-образах, `catalog-info.yaml`, конфигом Renovate и CI. Workflow вызывает переиспользуемые workflow из [`ci-templates`](https://github.com/as-platform/ci-templates) (`@main`): lint и тесты Go, проверка безопасности (gitleaks, trivy, hadolint, semgrep), затем сборка, скан, push и подпись образа cosign, затем смена тега образа в `k3s`.

## Проверки

```text
npm ci
npm test                  # схема шаблона, правила формы, результат рендера двух фикстур
npm run render -- back-go-full
npm run check:rendered    # go vet, тесты, golangci-lint, actionlint, hadolint на отрендеренных проектах
```

`check:rendered` требует `go`, `golangci-lint`, `actionlint` и `hadolint` в `PATH`. CI этого репозитория гоняет то же самое на GitHub-hosted раннере. Версии и sha256 этих четырёх инструментов закреплены в `.github/workflows/ci.yml` и обновляются вручную; actions и npm-пакеты обновляет Renovate. Тест смены тега образа хранит копию скрипта `awk` из `ci-templates/actions/bump-image-tag`; менять их нужно вместе.

## После создания сервиса шаблоном

Новому репозиторию нужны свои переменная и секреты: секреты и переменные уровня организации приватным репозиториям на плане Free недоступны.

```text
gh variable set ZOT_REGISTRY --body zot.homelab -R as-platform/<имя>
gh secret set ZOT_USER -R as-platform/<имя>
gh secret set ZOT_PASSWORD -R as-platform/<имя>
gh secret set COSIGN_PRIVATE_KEY -R as-platform/<имя> < cosign.key
gh secret set COSIGN_PASSWORD -R as-platform/<имя>
gh secret set PLATFORM_TOKEN -R as-platform/<имя>
```

`PLATFORM_TOKEN` — fine-grained personal access token только на репозиторий `k3s` с правом `Contents: Read and write`. Он позволяет CI сервиса коммитить новый тег образа.

Первый деплой:

1. PR в `k3s` пока не мержить. Первый push в новый репозиторий падает ещё до появления секретов: задай их и перезапусти workflow.
2. `go`, `security` и `image` зелёные. `deploy` падает с `values.yaml not found`: файла в `k3s` ещё нет.
3. Смержить PR. Application `Degraded` (`ImagePullBackOff` на временном теге `bootstrap`) до следующего шага.
4. Перезапустить job `deploy`: он коммитит настоящий тег, Argo CD синкает, сервис отвечает на `https://<имя>.homelab`. Добавь `<имя>.homelab` в `/etc/hosts` рядом с остальными `*.homelab`.

## Что ещё не сделано

- Запуск шаблона в Backstage (dry run, интеграция с GitHub, свой action для секретов репозитория).
- Остальные три шаблона, опция harness `as-skill` в форме и общие части `_shared/{harness,ci}`: CI лежит в скелете `back-go`, пока он не понадобится второму шаблону.
- Ссылка на PR в `k3s` в выводе при выключенном деплое в dev указывает на пропущенный шаг; проверить на первом dry run.

## Связанные репозитории

- [`backstage`](https://github.com/as-platform/backstage) — портал, который читает эти шаблоны
- [`ci-templates`](https://github.com/as-platform/ci-templates) — переиспользуемые workflow, которые вызывают созданные репозитории
- [`k3s`](https://github.com/as-platform/k3s) — GitOps-репозиторий, куда уходит PR с деплоем

## Лицензия

MIT — см. [`LICENSE`](LICENSE).
