# backstage-templates

🇬🇧 [English version](README.md)

Шаблоны scaffolder Backstage и скелеты репозиториев для домашней платформы [as-platform](https://github.com/as-platform) с подключёнными CI/CD и security.

> **Статус: четыре шаблона, все запущены из портала.** `back-go` запущен из портала [`backstage`](https://github.com/as-platform/backstage) 2026-11-09 с включённой и выключенной опцией деплоя. `back-python`, `front-react` и `monorepo` запущены из портала 2026-11-15 с включённым деплоем: каждый создал приватный репозиторий, дал зелёный CI с подписанными образами в реестре, смену тега образа в `k3s`, Application `Synced`/`Healthy` и ответ по HTTPS. У `monorepo` проверена и выборочная сборка тремя push'ами: правка только в `services/web` собрала и выкатила только фронтенд, правка только в `services/api` только API, правка только в Markdown-файле ничего. **Не проверено:** `back-go` после переноса его CI в `skeletons/_shared/ci` (вывод рендера побайтно прежний и общий файл проверен другими шаблонами, но сам шаблон заново не запускался), `monorepo` с API на Python (только рендер и проверки) и dry run любого шаблона.

## Структура

```text
.
├── scaffolder
│   ├── back-go/template.yaml        # бэкенд-сервис на Go
│   ├── back-python/template.yaml    # бэкенд-сервис на Python (FastAPI)
│   ├── front-react/template.yaml    # фронтенд на React (Vite, TypeScript)
│   └── monorepo/template.yaml       # API (Go или Python) и фронтенд на React в одном репозитории
├── skeletons
│   ├── back-go/                     # скелет Go-сервиса
│   ├── back-python/                 # скелет Python-сервиса
│   ├── front-react/                 # скелет React и его статический сервер
│   ├── monorepo/                    # корень монорепо: ci.yml, README, каталог
│   ├── _shared/ci/                  # ci.yml и renovate.json, общие для шаблонов сервисов
│   └── _shared/platform-pr/         # values.yaml для PR в k3s
├── scripts                          # render.mjs, check-rendered.sh
└── tests                            # фикстуры и npm test
```

## Что делает каждый шаблон

**Шаги:** рендер скелета → создание репозитория → доступ репозитория к runner group → рендер `apps/<имя>/values.yaml` → PR в [`k3s`](https://github.com/as-platform/k3s) → регистрация компонента в каталоге. Рендер values и PR выполняются только при включённом деплое в dev, доступ к раннерам и регистрация идут всегда. Шаг доступа к раннерам вызывает собственное действие портала `github:runner-group:add-repo`: без него CI нового приватного репозитория стоит в очереди, потому что runner group `Default` ограничена выбранными репозиториями.

**Форма** спрашивает имя, описание, владельца (группа каталога) и деплой в dev (по умолчанию включён). Имя становится именем репозитория, namespace, Application в Argo CD и релиза Helm: от 3 до 32 символов (28 у `monorepo`), строчные буквы, цифры и дефисы. Имена компонентов платформы и их namespace отклоняются; `monorepo` отклоняет ещё `kube` и систему каталога `as-platform`. Репозитории всегда создаются приватными: их CI идёт на self-hosted раннерах.

**Созданный сервис** слушает `:8080`, отдаёт `/healthz` и `/readyz`, корректно завершается и приходит с Dockerfile на golden-образах, `catalog-info.yaml`, конфигом Renovate и CI. Workflow вызывает переиспользуемые workflow из [`ci-templates`](https://github.com/as-platform/ci-templates) (`@main`): CI языка, проверка безопасности (gitleaks, trivy, hadolint, semgrep), затем сборка, скан, push и подпись образа cosign, затем смена тега образа в `k3s`. Контейнеры работают от пользователя `65532` на read-only корневой файловой системе, поэтому сервис не должен писать на диск.

## Шаблоны

- **`back-go`**: стандартная библиотека Go, `golangci-lint`, `go test -race`.
- **`back-python`**: FastAPI и uvicorn, `uv` с закоммиченным `uv.lock`, `ruff`, `pytest`. Образ ставит зафиксированные зависимости через `uv pip install --target` (без виртуального окружения: пути интерпретатора в образе сборки и в distroless-рантайме различаются) и не содержит компилятора, поэтому работают только пакеты с wheels. Application получает лимит памяти `256Mi`.
- **`front-react`**: Vite, React и TypeScript с `vitest`, `eslint` и `tsc`. Образа веб-сервера нет, поэтому репозиторий несёт небольшой статический сервер на Node (`server/server.mjs`, только стандартная библиотека, SPA-fallback, `/healthz`, `/readyz`, без записи на диск), который работает на `golden/runtime:node`. `.npmrc` фиксирует точные версии и ждёт семь дней после выхода новых релизов.
- **`monorepo`**: `services/api` (Go или Python по выбору в форме) и `services/web` (скелет React). Каждый сервис — свой образ и свой Application (`<имя>-api`, `<имя>-web`) со своим namespace и хостом; один PR в `k3s` добавляет оба. CI собирает и деплоит только сервисы, чьи файлы изменились: правка вне `services/*` выбирает оба, правка только Markdown не выбирает ни одного. Сервисы из коробки друг с другом не связаны. В каталоге появляются одна System и два Component.

Отложено: опция harness `as-skill` в форме.

## Проверки

```text
npm ci
npm test                  # схема, правила формы, результат рендера восьми фикстур
npm run render -- back-go-full
npm run check:rendered    # lint, тесты, сборка, actionlint, hadolint на каждом отрендеренном проекте
RUN_SCANS=true npm run check:rendered   # плюс trivy и semgrep
```

`check:rendered` рендерит каждую фикстуру и запускает проверки её языка: `gofmt`, `go vet`, `go test -race` и `golangci-lint` для Go, `uv sync --locked`, `ruff` и `pytest` для Python, `npm ci`, lint, typecheck, тесты и сборку для Node. Каждый Dockerfile проходит `hadolint`, каждый workflow — `actionlint`. Нужны `go`, `golangci-lint`, `uv`, `node`, `actionlint` и `hadolint` в `PATH`, а для сканов ещё `trivy` и `uvx`. CI этого репозитория гоняет это на GitHub-hosted раннере; сканы идут там по понедельникам и по ручному запуску, поэтому новая уязвимость в lock-файле видна как красный недельный прогон, а не как красный push. `golangci-lint`, `actionlint`, `hadolint` и `trivy` закреплены по версии и sha256 в `.github/workflows/ci.yml`, `uv` по версии там же, `semgrep` по версии в `scripts/check-rendered.sh`; все они обновляются вручную; actions и npm-пакеты обновляет Renovate, но `skeletons/**` он игнорирует, поэтому lock-файлы скелетов (`uv.lock`, `package-lock.json`) тоже обновляются вручную. Тест смены тега образа хранит копию скрипта `awk` из `ci-templates/actions/bump-image-tag`; менять их нужно вместе.

Тесты также отвергают комментарии и подавление линтеров в отрендеренных файлах, файлы-игноры сканеров в скелетах и любой файл, пропущенный из-за того, что его уже записал предыдущий шаг. `scripts/render.mjs` повторяет поведение `fetch:template` портала (пропуск существующих файлов, `copyWithoutTemplating`, бинарные файлы, права файлов).

## После создания сервиса шаблоном

Новому репозиторию нужны свои переменная и секреты: секреты и переменные уровня организации приватным репозиториям на плане Free недоступны. Переменную `ZOT_REGISTRY` шаблон ставит сам.

```text
gh variable set ZOT_REGISTRY --body zot.homelab -R as-platform/<имя>
gh secret set ZOT_USER -R as-platform/<имя>
gh secret set ZOT_PASSWORD -R as-platform/<имя>
gh secret set COSIGN_PRIVATE_KEY -R as-platform/<имя> < cosign.key
gh secret set COSIGN_PASSWORD -R as-platform/<имя>
gh secret set PLATFORM_TOKEN -R as-platform/<имя>
```

`PLATFORM_TOKEN` — fine-grained personal access token только на репозиторий `k3s` с правом `Contents: Read and write`. Он позволяет CI сервиса коммитить новый тег образа. Если токен отклонён (`Invalid username or token` в job `deploy`), он истёк или не одобрен организацией.

GitHub фиксирует значения секретов при создании рана. Первый push в новый репозиторий запускает ран до появления секретов, поэтому задай секреты, дождись, пока этот ран завершится (или отмени его), и только потом перезапусти его командой `gh run rerun <id> --failed`. Пока ран идёт, перезапуск отклоняется, а job, стартовавший после установки секретов, всё равно видит их пустыми.

Первый деплой:

1. PR в `k3s` пока не мержить.
2. После перезапуска `go`, `python` или `node`, `security` и `image` зелёные. `deploy` падает с `values.yaml not found`: файла в `k3s` ещё нет.
3. Смержить PR. Application `Degraded` (`ImagePullBackOff` на временном теге `bootstrap`) до следующего шага.
4. Перезапустить job `deploy`: он коммитит настоящий тег, Argo CD синкает (он опрашивает Git раз в несколько минут), сервис отвечает на `https://<имя>.homelab`. Добавь `<имя>.homelab` в `/etc/hosts` рядом с остальными `*.homelab`. У `monorepo` два job'а (`deploy-api`, `deploy-web`) и два имени, `<имя>-api.homelab` и `<имя>-web.homelab`.

После удаления репозитория сервиса убери и `apps/<имя>` из `k3s`: устаревший каталог молча перезапишется pull request'ом нового сервиса с тем же именем. Производные имена монорепо (`<имя>-api`, `<имя>-web`) уникальность имён репозиториев тоже не защищает.

## Что ещё не сделано

- Dry run шаблонов. Шаблоны берут скелеты вне своей папки, а Template Editor их не видит.
- Секреты репозиториев остаются ручным шагом: у портала нет пароля реестра и ключа подписи. План — отказаться от секретов репозиториев и читать их в CI из OpenBao по OIDC-токену GitHub (не начато).
- Опция harness `as-skill` в форме (отложена).
- Структурная защита от коллизий имён сервисов (префикс в имени Application в ApplicationSet `apps`): сегодня работает только список зарезервированных имён.
- Форма отклоняет зарезервированное имя общим сообщением `'Name' must NOT be valid`; описание поля поясняет, что имена платформы зарезервированы.

## Связанные репозитории

- [`backstage`](https://github.com/as-platform/backstage) — портал, который читает эти шаблоны
- [`ci-templates`](https://github.com/as-platform/ci-templates) — переиспользуемые workflow, которые вызывают созданные репозитории
- [`k3s`](https://github.com/as-platform/k3s) — GitOps-репозиторий, куда уходит PR с деплоем

## Лицензия

MIT — см. [`LICENSE`](LICENSE).
