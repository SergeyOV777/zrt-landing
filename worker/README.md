# Cloudflare Worker ZRT

Worker принимает публичные заявки на `POST /v1/leads` и ведёт независимый
обезличенный журнал в D1. Отдельный Worker `zrt-lead-statistics` показывает
закрытый экран, отдаёт статистику через `/statistics/api` и формирует CSV через
`/statistics/api/export.csv`.

## Безопасность статистики

- Cloudflare Access защищает весь Worker `zrt-lead-statistics` и его адрес
  `zrt-lead-statistics.magniffique.workers.dev`.
- Политика Access разрешает только явно указанный email и вход One-time PIN.
- Cloudflare проверяет Access до запуска выделенного Worker, поэтому его страница,
  API, CSV и статические файлы закрыты одной политикой.
- Для статических файлов отключена автоматическая канонизация HTML-путей
  (`html_handling: none`), чтобы запрос `/` не зацикливался между `/` и
  `/index.html`.
- В Cookie settings приложения используется `Same Site Attribute: Lax`, а
  `Enable Binding Cookie` и `Eager redirect cookie` выключены, чтобы вход по
  одноразовому коду не попадал в цикл перенаправлений.
- Маршруты статистики в публичном Worker оставлены как резервный вариант и
  дополнительно проверяют подпись Access JWT, audience и email.
- SQL статистики и CSV не выбирают имена, телефоны и `amo_contact_id`.

Для проверки JWT нужны несекретные переменные:

- `ACCESS_TEAM_DOMAIN` — домен вида `<team>.cloudflareaccess.com`;
- `ACCESS_AUD` — audience созданного Access application;
- `ACCESS_ALLOWED_EMAIL` — разрешённые email через запятую.

Секрет `AMO_LONG_LIVED_TOKEN` задаётся только через Cloudflare и в Git не
добавляется.

## Изменения и развёртывание

```text
wrangler deploy --dry-run --config wrangler.jsonc
wrangler d1 migrations list zrt-lead-journal --remote --config wrangler.jsonc
wrangler d1 migrations apply zrt-lead-journal --remote --config wrangler.jsonc
wrangler deploy --config wrangler.jsonc --keep-vars
wrangler deploy --config wrangler.statistics.jsonc
```

Перед развёртыванием нужно проверить `/health`, CORS публичной формы и отсутствие
новых записей D1 после отрицательного теста с пустым JSON. Access application для
статистики создаётся с типом Workers и scope `zrt-lead-statistics`; настройки DNS
и публичного сайта `adv.zrt-school.ru` для этого не меняются.
