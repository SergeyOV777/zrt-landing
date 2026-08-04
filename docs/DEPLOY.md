# Как устроена публикация adv.zrt-school.ru

Документ для разработчика/агента, который будет чинить или менять механику выката.
Инструкция для маркетолога — в [`HANDOVER.md`](../HANDOVER.md), правила правки
контента — в [`AGENTS.md`](../AGENTS.md).

## Схема

```
pull request  ──> проверка страниц ──> черновик /_preview/pr-<N>/  ──> ссылка комментарием в PR
merge в main  ──> проверка страниц ──> релиз ──> симлинк current ──> https://adv.zrt-school.ru
```

Публикует **только GitHub Actions** (`.github/workflows/site.yml`). С ноутбука сайт
выложить нельзя: приватного ключа локально нет. Это осознанное решение — в июне 2026
единый deploy-ключ, лежавший на рабочей машине, уже стоил компрометации сервера.

## Сервер

Хост `72.56.236.203` — тот же, где живёт `zrt-gift-v2` (`api.zrt-gift.ru`). Лендинг
изолирован от него настолько, насколько это возможно без второго VPS:

| Что | Значение |
|---|---|
| Unix-юзер | `advdeploy` (отдельный от `deploy`, пароль заблокирован, sudo нет) |
| Корень сайта | `/var/www/adv.zrt-school.ru/current` → симлинк на `releases/<UTC-таймстамп>` |
| Черновики | `/var/www/adv.zrt-school.ru/preview-root/_preview/<slug>/` |
| Хранится релизов | 5 последних; черновики удаляются через 14 дней |
| nginx | `/etc/nginx/sites-available/adv.zrt-school.ru`, статика, без проксирования |
| Приёмник выката | `/usr/local/bin/adv-release` (владелец root, `advdeploy` изменить не может) |

Никакого Node, pm2 и открытого порта у лендинга нет — только файлы, которые отдаёт
nginx. Исполняемого кода на сервере лендинг не приносит.

### Ключ и его ограничения

В `/home/advdeploy/.ssh/authorized_keys` ключ прибит к forced command:

```
command="/usr/local/bin/adv-release",restrict ssh-ed25519 AAAA... adv-zrt-school-ci-20260804
```

`restrict` снимает pty, порт-форвардинг, агент-форвардинг и `~/.ssh/rc`. Всё, что
может ключ, — это две команды:

- `publish` (по умолчанию) — принять gzip-tar со stdin, развернуть новым релизом,
  атомарно (`mv -T`) переключить `current`, подчистить старые релизы;
- `preview <slug>` — то же, но в каталог черновика; `slug` проверяется регуляркой
  `^[a-z0-9][a-z0-9-]{0,39}$`.

Санити-гейт: если в архиве нет `index.html`, публикация отменяется и живой сайт
остаётся нетронутым. Попытка выполнить что-либо ещё возвращает ошибку:

```
$ ssh -i adv_ci advdeploy@72.56.236.203 "cat /etc/passwd"
adv-release: неизвестная команда «cat /etc/passwd» (доступно: publish, preview <slug>)
```

## Секреты GitHub (репозиторий `SergeyOV777/zrt-landing`)

| Секрет | Что внутри |
|---|---|
| `ADV_DEPLOY_HOST` | IP сервера |
| `ADV_SSH_PRIVATE_KEY` | приватный ed25519-ключ выката (нигде больше не хранится) |
| `ADV_KNOWN_HOSTS` | пин host key сервера, чтобы CI не доверял первому встречному |

## TLS

Сертификат выпускается после того, как A-запись `adv.zrt-school.ru` в Cloudflare
показывает на `72.56.236.203` (зона `zrt-school.ru`, режим DNS only):

```bash
ssh root@72.56.236.203
certbot --nginx -d adv.zrt-school.ru --agree-tos -m info@zrt-school.ru --redirect
nginx -t && systemctl reload nginx
```

Автопродление уже работает системным `certbot.timer` (тот же, что обслуживает
`api.zrt-gift.ru`). Локация `/.well-known/acme-challenge/` в vhost'е отдаётся из
`/var/www/letsencrypt` и не перехватывается правилами сайта.

## Откат

Ssh для отката не нужен и не предусмотрен — откат делается через git:

```bash
git revert <коммит>      # или git revert --no-commit <диапазон>
# → pull request → merge → CI выкладывает предыдущее состояние
```

Прошлые релизы физически лежат на сервере (`releases/`, последние 5) — это страховка
на случай, когда GitHub недоступен. Тогда с root-доступом:

```bash
ln -sfn /var/www/adv.zrt-school.ru/releases/<нужный> /var/www/adv.zrt-school.ru/current.tmp
mv -T /var/www/adv.zrt-school.ru/current.tmp /var/www/adv.zrt-school.ru/current
```

Следующий merge в `main` всё равно перезапишет `current` — ручной откат временный.

## Диагностика

```bash
# сайт отвечает независимо от DNS и сертификата
curl -I -H "Host: adv.zrt-school.ru" http://72.56.236.203/

# что сейчас опубликовано
ssh root@72.56.236.203 'ls -l /var/www/adv.zrt-school.ru/current; ls /var/www/adv.zrt-school.ru/releases'

# логи
ssh root@72.56.236.203 'tail -50 /var/log/nginx/adv.zrt-school.ru.error.log'
```

Частые случаи:

- **CI падает на «Проверка страниц»** — читать вывод `scripts/check-site.mjs`,
  там текстом сказано, какая страница и что именно сломано.
- **CI падает на «Опубликовать»** с `Permission denied (publickey)` — расходится
  ключ в секрете `ADV_SSH_PRIVATE_KEY` и `authorized_keys` на сервере.
- **`Host key verification failed`** — сменился host key сервера, обновить
  `ADV_KNOWN_HOSTS` (`ssh-keyscan -t ed25519 72.56.236.203`).
- **Правка не видна в браузере** — HTML отдаётся с `Cache-Control: no-cache`,
  так что дело почти всегда в кэше самого браузера (Ctrl+Shift+R) или в том, что
  PR не смержен.

## Ротация ключа выката

```bash
ssh-keygen -t ed25519 -N "" -C "adv-zrt-school-ci-$(date +%Y%m%d)" -f /tmp/adv_ci_new
# на сервере (root):
printf 'command="/usr/local/bin/adv-release",restrict %s\n' "$(cat /tmp/adv_ci_new.pub)" \
  > /home/advdeploy/.ssh/authorized_keys
# в GitHub:
gh secret set ADV_SSH_PRIVATE_KEY --repo SergeyOV777/zrt-landing < /tmp/adv_ci_new
rm -f /tmp/adv_ci_new /tmp/adv_ci_new.pub    # приватный ключ на диске не оставлять
```

## Что осталось незакрытым

- **Форма заявок не отправляет данные** (`site/script-improved.js`, `handleSubmit`) —
  имитация отправки. Пока не подключён приёмник (amoCRM/почта/телеграм), рекламный
  трафик на этих страницах превращается в потерянные заявки.
- **Фото главной страницы** грузятся с `static.tildacdn.com` — внешняя зависимость
  от старого Tilda-аккаунта.
- Лендинг делит VPS с боевой системой сертификатов. Изоляция сделана (отдельный
  юзер, forced command, отсутствие исполняемого кода), но полная развязка — это
  отдельный дешёвый VPS.
