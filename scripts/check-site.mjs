#!/usr/bin/env node
// Гейт качества сайта adv.zrt-school.ru. Гоняется локально (`node scripts/check-site.mjs`)
// и в CI перед каждой публикацией. Задача — ловить ошибки, которые не видно в diff-е,
// но которые сразу видит клиент: битая ссылка на файл, забытая рыба в тексте,
// страница без заголовка, картинка по http внутри https-страницы.
//
// Проверяем только каталог site/ — ровно то, что уезжает на сервер.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, extname } from "node:path";

const ROOT = resolve(process.argv[2] ?? "site");
const errors = [];
const warnings = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

if (!existsSync(ROOT)) {
  console.error(`Нет каталога ${ROOT} — публиковать нечего.`);
  process.exit(1);
}

const files = walk(ROOT);
const pages = files.filter((f) => extname(f) === ".html");

if (!files.some((f) => relative(ROOT, f) === "index.html")) {
  errors.push("site/index.html отсутствует — сервер откажется публиковать такой выкат.");
}
if (pages.length === 0) {
  errors.push("В site/ нет ни одной .html-страницы.");
}

// Метки-заглушки из templates/page.html: если они доехали до site/, страницу
// просто забыли дописать.
const PLACEHOLDERS = [
  "ЗАПОЛНИТЬ",
  "ЗАГОЛОВОК СТРАНИЦЫ",
  "ОПИСАНИЕ СТРАНИЦЫ",
  "ГЛАВНЫЙ ЗАГОЛОВОК",
  "ЗАГОЛОВОК БЛОКА",
  "Lorem ipsum",
  "TODO",
];

for (const page of pages) {
  const rel = relative(ROOT, page);
  const html = readFileSync(page, "utf8");

  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  if (!title) errors.push(`${rel}: нет тега <title> — страница будет без названия во вкладке и в выдаче.`);

  const description = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i)?.[1]?.trim();
  if (!description) warnings.push(`${rel}: нет <meta name="description"> — соцсети и поиск покажут случайный текст.`);

  if (!/lang=["']ru["']/i.test(html)) warnings.push(`${rel}: у <html> не проставлен lang="ru".`);

  for (const marker of PLACEHOLDERS) {
    if (html.includes(marker)) errors.push(`${rel}: осталась заглушка «${marker}» — текст не дописан.`);
  }

  // Ссылки на файлы: href/src, кроме внешних, якорей, tel/mailto и пустых.
  const refs = [...html.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);
  for (const ref of refs) {
    if (!ref || ref.startsWith("#") || ref.startsWith("mailto:") || ref.startsWith("tel:") || ref.startsWith("data:")) continue;

    if (ref.startsWith("http://")) {
      errors.push(`${rel}: ссылка по незащищённому http — «${ref}». Браузер заблокирует её на https-странице.`);
      continue;
    }
    if (ref.startsWith("https://") || ref.startsWith("//")) continue;

    const target = ref.split(/[?#]/)[0];
    const base = target.startsWith("/") ? join(ROOT, target) : resolve(dirname(page), target);
    const candidates = [base, `${base}.html`, join(base, "index.html")];
    if (!candidates.some((c) => existsSync(c))) {
      errors.push(`${rel}: ссылка на «${ref}» ведёт в никуда — такого файла в site/ нет.`);
    }
  }
}

// Форма заявок: пока она заглушка, каждая новая страница молча теряет лиды.
// Не роняем сборку (это осознанное состояние сайта), но напоминаем при каждом выкате.
for (const page of pages) {
  const html = readFileSync(page, "utf8");
  if (html.includes('id="contactForm"')) {
    const js = existsSync(join(ROOT, "script-improved.js")) ? readFileSync(join(ROOT, "script-improved.js"), "utf8") : "";
    if (!/fetch\s*\(|XMLHttpRequest|action\s*=\s*["']https?:/.test(js)) {
      warnings.push(
        `${relative(ROOT, page)}: форма заявки никуда не отправляет данные (в script-improved.js нет запроса на сервер) — заявки клиентов теряются.`,
      );
      break;
    }
  }
}

const totalBytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
console.log(`Проверено страниц: ${pages.length}, файлов всего: ${files.length}, размер: ${(totalBytes / 1024).toFixed(0)} КБ`);

for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.log(`  ✖ ${e}`);

if (errors.length) {
  console.error(`\nПроверка не пройдена: ошибок ${errors.length}. Публикация остановлена.`);
  process.exit(1);
}
console.log(warnings.length ? "\nПроверка пройдена (с предупреждениями)." : "\nПроверка пройдена.");
