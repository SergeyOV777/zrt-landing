# Офлайн-конверсия реальной заявки ZRT

Эта настройка добавляет в Метрику отдельную цель `lead_created_crm` только после
того, как Cloudflare Worker успешно создал сделку в amoCRM. Существующая браузерная
цель `lead_sent` остаётся без изменений и не задваивается.

Сайт сохраняет `yclid` из перехода Директа на 21 день и получает анонимный
`ClientId` методом `getClientID` счётчика `32428555`. Имя и телефон по-прежнему не
попадают в D1-журнал. Идентификаторы лежат только в технической очереди до успешной
загрузки и после ответа Метрики очищаются.

## 1. Настроить Метрику

1. Откройте счётчик **32428555** → **Настройка** → **Загрузка данных** и включите
   **Учёт офлайн-конверсий**.
2. Откройте **Цели** → **Добавить цель**.
3. Название: `Заявка создана в amoCRM`.
4. Тип: **JavaScript-событие** (или «Целевое событие → JS-событие» в новом интерфейсе).
5. Идентификатор: `lead_created_crm`.
6. Условие: **Совпадает**. Сохраните цель.

Не заменяйте этой целью `lead_sent`: новая цель предназначена для серверного
подтверждения сделки, старая остаётся клиентской диагностикой формы.

## 2. Получить OAuth-токен Яндекса

1. На [oauth.yandex.ru](https://oauth.yandex.ru/) создайте приложение «Для доступа
   к API или отладки».
2. Выдайте приложению доступ `metrika:offline_data`. Вместо него допустим более
   широкий `metrika:write`.
3. Откройте ссылку
   `https://oauth.yandex.com/authorize?response_type=token&client_id=<ID_ПРИЛОЖЕНИЯ>`
   и авторизуйтесь аккаунтом, у которого есть доступ к счётчику 32428555.
4. Скопируйте токен. Не отправляйте его в чат, не вставляйте в сайт и не сохраняйте
   в репозитории.

## 3. Безопасно подготовить Cloudflare

Все команды выполняет разработчик только после отдельного подтверждения
«публикуй».

1. Добавить токен как secret:

   ```text
   npx wrangler secret put YANDEX_METRIKA_OAUTH_TOKEN --config worker/wrangler.jsonc
   ```

   `wrangler secret put` создаёт и сразу публикует новую версию Worker, поэтому этот
   шаг нельзя выполнять заранее без разрешения. Старый код секрет не использует.

2. Применить обратимо совместимую миграцию D1 до включения нового кода:

   ```text
   npx wrangler d1 migrations apply zrt-lead-journal --remote --config worker/wrangler.jsonc
   ```

3. Убедиться, что миграция `0003_create_metrika_offline_conversions.sql` отмечена
   как применённая.

## 4. Опубликовать Worker без риска для заявок

1. Загрузить новую версию без переключения трафика:

   ```text
   npx wrangler versions upload --config worker/wrangler.jsonc
   ```

2. Через `wrangler versions deploy` оставить текущую версию на 100%, а новую на 0%.
3. Проверить новую версию заголовком `Cloudflare-Workers-Version-Overrides`:
   `/health` → 200, разрешённый preflight → 204, пустой payload → 400, чужой Origin
   → 403. Тестовую сделку для этих проверок создавать не нужно.
4. Перевести новую версию на 100% и ещё раз выполнить четыре проверки.
5. Подключить расписание повторов:

   ```text
   npx wrangler triggers deploy --config worker/wrangler.jsonc
   ```

6. Только после этого объединить pull request сайта. Merge публикует `site/` на
   `https://adv.zrt-school.ru`; draft PR production не меняет.

## 5. Проверить реальный результат

После первой настоящей заявки:

1. Сделка должна появиться в amoCRM независимо от доступности Яндекса.
2. В D1 можно проверить только технические поля, без персональных данных:

   ```sql
   SELECT submission_id, status, attempts, upload_id, error_code, created_at, sent_at
   FROM metrika_offline_conversions
   ORDER BY created_at DESC
   LIMIT 10;
   ```

3. При `status = 'sent'` загрузка принята API. Обработка и появление в отчётах
   Метрики могут занять до двух часов.
4. Проверьте отчёт **Офлайн-конверсии** и цель `lead_created_crm`. Для `yclid`
   конверсия должна связаться с переходом Директа; окно привязки — 21 день.
5. После появления данных выберите `lead_created_crm` как целевое действие в
   нужной стратегии Яндекс Директа. Старую цель не отключайте, пока новая не
   подтверждена реальной заявкой и отчётом.

При недоступности Яндекса запись остаётся `pending`, а задержка повторов растёт от
одной минуты до шести часов. Одна заявка создаёт одну запись очереди. Если API мог
принять файл, но ответ потерялся, Worker повторяет абсолютно ту же строку; согласно
FAQ Метрики повтор той же строки обновляет прежнее значение, а не создаёт новое.

## Официальные источники

- [Передача офлайн-конверсий](https://yandex.ru/dev/metrika/ru/management/offline-conv)
- [Метод загрузки офлайн-конверсий](https://yandex.com/dev/metrika/en/management/openapi/offline_conversions/upload_1)
- [Получение ClientID](https://yandex.com/support/metrica/en/objects/get-client-id)
- [Получение yclid на сайте](https://yandex.ru/support/metrica/ru/data/get-yclid)
- [OAuth и права API Метрики](https://yandex.com/dev/metrika/en/intro/quick-start)
- [Cloudflare: секреты Worker](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare: version override](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/)
