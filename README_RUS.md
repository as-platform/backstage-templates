# backstage-templates

🇬🇧 [English version](README.md)

Шаблоны scaffolder Backstage и скелеты репозиториев для домашней платформы [as-platform](https://github.com/as-platform) с подключёнными CI/CD и security.

> **Статус: каркас.** Четыре файла `template.yaml` пустые, а в `skeletons/` лежит только `.gitkeep`. Запускать здесь пока нечего; разделы ниже описывают план.

## Структура

```text
.
├── scaffolder
│   ├── back-go/template.yaml        # бэкенд на Go (пусто)
│   ├── back-python/template.yaml    # бэкенд на Python (пусто)
│   ├── front-react/template.yaml    # фронтенд на React (пусто)
│   └── monorepo/template.yaml       # монорепозиторий (пусто)
└── skeletons/                       # скелеты репозиториев (пока только .gitkeep)
```

## План

- **Скелеты:** `skeletons/<тип>` для каждого шаблона и общие части в `skeletons/_shared/{harness,ci,security,platform-pr}`.
- **Форма:** имя, владелец, язык, harness (домены [`as-skill`](https://github.com/alexeyshishin/as-skill)), security, ночное отключение, деплой в dev.
- **Шаги:** скелет → harness → CI/security → создание репозитория → PR в `k3s` → регистрация в каталоге.

## Связанные репозитории

- [`backstage`](https://github.com/as-platform/backstage) — портал, который читает эти шаблоны
- [`ci-templates`](https://github.com/as-platform/ci-templates) — переиспользуемые workflow, которые вызывают созданные репозитории
- [`k3s`](https://github.com/as-platform/k3s) — GitOps-репозиторий, куда уходит PR с деплоем

## Лицензия

MIT — см. [`LICENSE`](LICENSE).
