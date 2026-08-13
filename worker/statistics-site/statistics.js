const statsEndpoint = '/statistics/api';
const moscowTimeZone = 'Europe/Moscow';

const elements = {
  form: document.querySelector('#filterForm'),
  from: document.querySelector('#dateFrom'),
  to: document.querySelector('#dateTo'),
  source: document.querySelector('#source'),
  utmSource: document.querySelector('#utmSource'),
  campaign: document.querySelector('#utmCampaign'),
  refresh: document.querySelector('#refreshButton'),
  export: document.querySelector('#exportButton'),
  status: document.querySelector('#dashboardStatus'),
  lastUpdated: document.querySelector('#lastUpdated'),
  total: document.querySelector('#metricTotal'),
  beginner: document.querySelector('#metricBeginner'),
  beginnerShare: document.querySelector('#metricBeginnerShare'),
  experienced: document.querySelector('#metricExperienced'),
  experiencedShare: document.querySelector('#metricExperiencedShare'),
  deals: document.querySelector('#metricDeals'),
  conversion: document.querySelector('#metricConversion'),
  errors: document.querySelector('#metricErrors'),
  failedNow: document.querySelector('#metricFailedNow'),
  chart: document.querySelector('#dailyChart'),
  chartEmpty: document.querySelector('#chartEmpty'),
  sources: document.querySelector('#sourcesTable'),
  sourcesEmpty: document.querySelector('#sourcesEmpty'),
  errorRows: document.querySelector('#errorsTable'),
  errorsEmpty: document.querySelector('#errorsEmpty'),
  submissions: document.querySelector('#submissionsTable'),
  submissionsEmpty: document.querySelector('#submissionsEmpty')
};

const numberFormatter = new Intl.NumberFormat('ru-RU');
const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: moscowTimeZone,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});
const shortDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit'
});

function moscowDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: moscowTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDate(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
}

function calendarMonthRange(dateString, monthOffset) {
  const [year, month] = dateString.split('-').map(Number);
  const firstDay = new Date(Date.UTC(year, month - 1 + monthOffset, 1, 12));
  const lastDay = new Date(Date.UTC(year, month + monthOffset, 0, 12));
  return {
    from: firstDay.toISOString().slice(0, 10),
    to: lastDay.toISOString().slice(0, 10)
  };
}

function quickPeriodRange(period, today) {
  if (period === 'today') return { from: today, to: today };
  if (period === 'yesterday') {
    const yesterday = shiftDate(today, -1);
    return { from: yesterday, to: yesterday };
  }
  if (period === 'previous-week') {
    const currentWeekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const daysSinceMonday = (currentWeekday + 6) % 7;
    const previousMonday = shiftDate(today, -(daysSinceMonday + 7));
    return { from: previousMonday, to: shiftDate(previousMonday, 6) };
  }
  if (period === 'previous-month') return calendarMonthRange(today, -1);
  if (period === 'current-month') {
    return { from: calendarMonthRange(today, 0).from, to: today };
  }
  if (period === 'all') return { from: '2020-01-01', to: today };
  return { from: shiftDate(today, -(Number(period) - 1)), to: today };
}

function currentFilters() {
  return {
    from: elements.from.value,
    to: elements.to.value,
    source: elements.source.value,
    utm_source: elements.utmSource.value,
    utm_campaign: elements.campaign.value
  };
}

function filtersToParams(filters = currentFilters()) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params;
}

function setDefaultPeriod() {
  const params = new URLSearchParams(window.location.search);
  const today = moscowDateString();
  elements.to.value = params.get('to') || today;
  elements.from.value = params.get('from') || shiftDate(elements.to.value, -29);
  elements.source.dataset.initialValue = params.get('source') || '';
  elements.utmSource.dataset.initialValue = params.get('utm_source') || '';
  elements.campaign.dataset.initialValue = params.get('utm_campaign') || '';
}

function setLoading(isLoading) {
  elements.refresh.disabled = isLoading;
  elements.refresh.setAttribute('aria-busy', String(isLoading));
  elements.form.querySelector('button[type="submit"]').disabled = isLoading;
  if (isLoading) {
    elements.status.classList.remove('is-error');
    elements.status.textContent = 'Обновляем статистику…';
  }
}

function formatNumber(value) {
  return numberFormatter.format(Number(value) || 0);
}

function percent(part, total) {
  if (!total) return '0%';
  return `${Math.round((Number(part) / Number(total)) * 100)}%`;
}

function displayValue(value) {
  return value || 'без метки';
}

function replaceOptions(select, values, selectedValue, fallbackLabel) {
  const fragment = document.createDocumentFragment();
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = fallbackLabel;
  fragment.append(allOption);

  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    fragment.append(option);
  });

  select.replaceChildren(fragment);
  select.value = values.includes(selectedValue) ? selectedValue : '';
}

function makeCell(value, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = value;
  if (!value || value === 'без метки') cell.classList.add('table-placeholder');
  return cell;
}

function makePill(value, type) {
  const span = document.createElement('span');
  span.className = `${type}-pill ${type}-pill--${value}`;
  span.textContent = type === 'scenario'
    ? (value === 'experienced' ? 'Уже катал' : 'Новичок')
    : ({ sent: 'Создана сделка', failed: 'Ошибка', processing: 'Отправляется' }[value] || value);
  return span;
}

function renderMetrics(totals) {
  const filled = Number(totals.filled) || 0;
  elements.total.textContent = formatNumber(filled);
  elements.beginner.textContent = formatNumber(totals.beginner);
  elements.beginnerShare.textContent = `${percent(totals.beginner, filled)} от заполнений`;
  elements.experienced.textContent = formatNumber(totals.experienced);
  elements.experiencedShare.textContent = `${percent(totals.experienced, filled)} от заполнений`;
  elements.deals.textContent = formatNumber(totals.deals_created);
  elements.conversion.textContent = `${percent(totals.deals_created, filled)} от заполнений`;
  elements.errors.textContent = formatNumber(totals.error_events);
  elements.failedNow.textContent = `сейчас не доставлено: ${formatNumber(totals.failed_now)}`;
}

function renderChart(rows) {
  elements.chart.replaceChildren();
  elements.chartEmpty.hidden = rows.length > 0;
  elements.chart.hidden = rows.length === 0;
  if (!rows.length) return;

  const maxValue = Math.max(1, ...rows.map((row) => Number(row.filled) || 0));
  const labelStep = rows.length > 45 ? 7 : rows.length > 20 ? 4 : rows.length > 10 ? 2 : 1;

  rows.forEach((row, index) => {
    const day = document.createElement('div');
    day.className = 'chart-day';
    day.title = `${row.date}: заполнено ${row.filled}, сделок ${row.deals}, ошибок ${row.errors}`;

    const bars = document.createElement('div');
    bars.className = 'chart-day__bars';
    const filled = document.createElement('span');
    filled.className = 'chart-day__bar';
    filled.style.height = `${Math.max(2, (Number(row.filled) / maxValue) * 100)}%`;
    const deals = document.createElement('span');
    deals.className = 'chart-day__bar chart-day__bar--deals';
    deals.style.height = `${Math.max(2, (Number(row.deals) / maxValue) * 100)}%`;
    bars.append(filled, deals);

    if (Number(row.errors) > 0) {
      const error = document.createElement('span');
      error.className = 'chart-day__error';
      error.title = `Ошибок: ${row.errors}`;
      bars.append(error);
    }

    const label = document.createElement('span');
    label.className = 'chart-day__label';
    label.textContent = index % labelStep === 0
      ? shortDateFormatter.format(new Date(`${row.date}T12:00:00Z`))
      : '';
    day.append(bars, label);
    elements.chart.append(day);
  });
}

function renderSources(rows) {
  const fragment = document.createDocumentFragment();
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.append(
      makeCell(displayValue(row.source)),
      makeCell(displayValue(row.utm_source)),
      makeCell(displayValue(row.utm_medium)),
      makeCell(displayValue(row.utm_campaign)),
      makeCell(displayValue(row.utm_content)),
      makeCell(displayValue(row.utm_term)),
      makeCell(formatNumber(row.filled), 'number-cell'),
      makeCell(formatNumber(row.deals), 'number-cell'),
      makeCell(formatNumber(row.errors), 'number-cell')
    );
    fragment.append(tr);
  });
  elements.sources.replaceChildren(fragment);
  elements.sourcesEmpty.hidden = rows.length > 0;
}

function errorLabel(code) {
  return {
    amo_timeout: 'amoCRM не ответила вовремя',
    amo_network_error: 'Сетевая ошибка amoCRM',
    amo_invalid_response: 'Некорректный ответ amoCRM',
    amo_secret_missing: 'Не настроен ключ amoCRM',
    journal_unavailable: 'Ошибка журнала заявок'
  }[code] || (code?.startsWith('amo_http_') ? `amoCRM вернула код ${code.slice(9)}` : code || 'Неизвестная ошибка');
}

function renderErrors(rows) {
  const fragment = document.createDocumentFragment();
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const scenario = document.createElement('td');
    scenario.append(makePill(row.scenario, 'scenario'));
    const status = document.createElement('td');
    status.append(makePill(row.current_status, 'status'));
    tr.append(
      makeCell(dateTimeFormatter.format(new Date(row.occurred_at))),
      scenario,
      makeCell(displayValue(row.source)),
      makeCell(displayValue(row.utm_source)),
      makeCell(displayValue(row.utm_campaign)),
      makeCell(formatNumber(row.attempt_number)),
      makeCell(errorLabel(row.error_code)),
      status
    );
    fragment.append(tr);
  });
  elements.errorRows.replaceChildren(fragment);
  elements.errorsEmpty.hidden = rows.length > 0;
}

function renderSubmissions(rows) {
  const fragment = document.createDocumentFragment();
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const scenario = document.createElement('td');
    scenario.append(makePill(row.scenario, 'scenario'));
    const status = document.createElement('td');
    status.append(makePill(row.status, 'status'));
    const deal = document.createElement('td');
    if (row.amo_lead_id) {
      const link = document.createElement('a');
      link.className = 'amo-link';
      link.href = `https://zrtschool.amocrm.ru/leads/detail/${row.amo_lead_id}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `№ ${row.amo_lead_id} ↗`;
      deal.append(link);
    } else {
      deal.textContent = '—';
      deal.className = 'table-placeholder';
    }
    tr.append(
      makeCell(dateTimeFormatter.format(new Date(row.received_at))),
      scenario,
      makeCell(displayValue(row.source)),
      makeCell(displayValue(row.page_path)),
      makeCell(({ telegram: 'Telegram', whatsapp: 'WhatsApp', max: 'MAX', phone: 'Звонок' })[row.contact_method] || row.contact_method),
      makeCell(displayValue(row.utm_source)),
      makeCell(displayValue(row.utm_campaign)),
      status,
      makeCell(formatNumber(row.attempts)),
      makeCell(formatNumber(row.error_events)),
      deal
    );
    fragment.append(tr);
  });
  elements.submissions.replaceChildren(fragment);
  elements.submissionsEmpty.hidden = rows.length > 0;
}

function updateUrlAndExport() {
  const params = filtersToParams();
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  elements.export.href = `${statsEndpoint}/export.csv${query ? `?${query}` : ''}`;
}

async function loadStatistics() {
  setLoading(true);
  updateUrlAndExport();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);

  try {
    const query = filtersToParams().toString();
    const response = await fetch(`${statsEndpoint}${query ? `?${query}` : ''}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    const contentType = response.headers.get('Content-Type') || '';
    if (!response.ok || !contentType.includes('application/json')) {
      const accessExpired = response.status === 401 || response.status === 403 || response.redirected || !contentType.includes('application/json');
      throw new Error(accessExpired ? 'Сессия входа завершилась. Обновите страницу и войдите снова.' : 'Статистика временно недоступна.');
    }
    const data = await response.json();
    if (data.ok !== true) throw new Error('Статистика временно недоступна.');

    const selectedSource = elements.source.value || elements.source.dataset.initialValue || '';
    const selectedUtmSource = elements.utmSource.value || elements.utmSource.dataset.initialValue || '';
    const selectedCampaign = elements.campaign.value || elements.campaign.dataset.initialValue || '';
    replaceOptions(elements.source, data.options.sources, selectedSource, 'Все сайты');
    replaceOptions(elements.utmSource, data.options.utm_sources, selectedUtmSource, 'Все utm_source');
    replaceOptions(elements.campaign, data.options.utm_campaigns, selectedCampaign, 'Все кампании');
    delete elements.source.dataset.initialValue;
    delete elements.utmSource.dataset.initialValue;
    delete elements.campaign.dataset.initialValue;

    renderMetrics(data.totals);
    renderChart(data.daily);
    renderSources(data.sources);
    renderErrors(data.errors);
    renderSubmissions(data.submissions);

    const updatedAt = dateTimeFormatter.format(new Date(data.generated_at));
    elements.lastUpdated.textContent = `Обновлено ${updatedAt} МСК`;
    elements.status.textContent = `Период: ${data.period.from} — ${data.period.to}, время московское.`;
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Сервер долго не отвечает. Попробуйте обновить ещё раз.'
      : (error?.message || 'Не удалось загрузить статистику.');
    elements.status.textContent = message;
    elements.status.classList.add('is-error');
  } finally {
    window.clearTimeout(timeout);
    setLoading(false);
  }
}

function setQuickPeriod(period) {
  const today = moscowDateString();
  const range = quickPeriodRange(period, today);
  elements.from.value = range.from;
  elements.to.value = range.to;

  document.querySelectorAll('[data-period]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.period === period);
  });
  loadStatistics();
}

document.querySelectorAll('[data-period]').forEach((button) => {
  button.addEventListener('click', () => setQuickPeriod(button.dataset.period));
});

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  document.querySelectorAll('[data-period]').forEach((button) => button.classList.remove('is-active'));
  loadStatistics();
});

elements.refresh.addEventListener('click', loadStatistics);

setDefaultPeriod();
loadStatistics();
