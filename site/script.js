const body = document.body;
const scenarioButtons = [...document.querySelectorAll("[data-scenario-select]")];
const variants = [...document.querySelectorAll("[data-variant]")];
const leadUtmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

function rememberLeadAttribution() {
  const params = new URLSearchParams(window.location.search);

  leadUtmKeys.forEach((key) => {
    const value = params.get(key);
    if (!value) return;

    try {
      localStorage.setItem(`lead_${key}`, value.slice(0, 300));
    } catch (error) {
      // Отправка формы работает и без локального хранилища.
    }
  });
}

function getLeadAttribution() {
  const attribution = {};
  const params = new URLSearchParams(window.location.search);

  leadUtmKeys.forEach((key) => {
    let value = params.get(key);

    if (!value) {
      try {
        value = localStorage.getItem(`lead_${key}`);
      } catch (error) {
        // UTM-метки необязательны для отправки заявки.
      }
    }

    if (value) attribution[key] = value.slice(0, 300);
  });

  return attribution;
}

function createSubmissionId() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

rememberLeadAttribution();

function setScenario(scenario, { scroll = false } = {}) {
  if (!['beginner', 'experienced'].includes(scenario)) return;

  body.dataset.scenario = scenario;
  variants.forEach((element) => {
    element.hidden = element.dataset.variant !== scenario;
  });

  scenarioButtons.forEach((button) => {
    const isActive = button.dataset.scenarioSelect === scenario;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  try {
    localStorage.setItem('zrt-scenario', scenario);
  } catch (error) {
    // Сайт остаётся полностью рабочим, даже если локальное хранилище недоступно.
  }

  if (scroll) {
    document.querySelector('#scenario')?.scrollIntoView({ behavior: 'smooth' });
  }
}

scenarioButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const isHeroButton = button.closest('.hero__choice');
    setScenario(button.dataset.scenarioSelect, { scroll: Boolean(isHeroButton) });
  });
});

try {
  const savedScenario = localStorage.getItem('zrt-scenario');
  if (savedScenario) setScenario(savedScenario);
} catch (error) {
  setScenario('beginner');
}

if (window.location.hash) {
  document.querySelector(window.location.hash)?.scrollIntoView({ behavior: 'auto' });
}

const phoneInput = document.querySelector('input[name="phone"]');

function formatPhone(value) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (!digits.startsWith('7')) digits = `7${digits}`;
  digits = digits.slice(0, 11);

  const parts = ['+7'];
  if (digits.length > 1) parts.push(` ${digits.slice(1, 4)}`);
  if (digits.length >= 5) parts.push(` ${digits.slice(4, 7)}`);
  if (digits.length >= 8) parts.push(`-${digits.slice(7, 9)}`);
  if (digits.length >= 10) parts.push(`-${digits.slice(9, 11)}`);
  return parts.join('');
}

phoneInput?.addEventListener('input', (event) => {
  event.target.value = formatPhone(event.target.value);
  event.target.closest('label')?.classList.remove('is-invalid');
});

document.querySelector('input[name="name"]')?.addEventListener('input', (event) => {
  event.target.closest('label')?.classList.remove('is-invalid');
});

const form = document.querySelector('#contactForm');
const successMessage = form?.querySelector('.form-success');
const errorMessage = form?.querySelector('.form-error');

function showSubmissionError(error) {
  const title = errorMessage?.querySelector('strong');
  const description = errorMessage?.querySelector('span');
  const messages = {
    rate_limited: [
      'Слишком много попыток отправки',
      'Подождите одну минуту и нажмите кнопку ещё раз. Введённые данные сохранены в форме.'
    ],
    already_processing: [
      'Заявка ещё отправляется',
      'Подождите несколько секунд и нажмите кнопку ещё раз. Повторная отправка не создаст дубль.'
    ],
    journal_unavailable: [
      'Сервис временно недоступен',
      'Повторите отправку через несколько минут. Введённые данные сохранены в форме.'
    ],
    crm_unavailable: [
      'Сервис временно недоступен',
      'Повторите отправку через несколько минут. Введённые данные сохранены в форме.'
    ],
    service_not_configured: [
      'Сервис временно недоступен',
      'Повторите отправку через несколько минут. Введённые данные сохранены в форме.'
    ]
  };
  const [messageTitle, messageDescription] = messages[error?.code] || [
    'Не удалось отправить заявку',
    'Попробуйте ещё раз или переключитесь между мобильным интернетом и Wi-Fi. Введённые данные сохранены в форме.'
  ];

  if (title) title.textContent = messageTitle;
  if (description) description.textContent = messageDescription;
  errorMessage.hidden = false;
  errorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const nameInput = form.elements.name;
  const phone = form.elements.phone;
  const privacy = form.elements.privacy;
  const honeypot = form.elements.website;
  const phoneDigits = phone.value.replace(/\D/g, '');
  let isValid = true;

  successMessage.hidden = true;
  errorMessage.hidden = true;

  nameInput.closest('label').classList.toggle('is-invalid', nameInput.value.trim().length < 2);
  phone.closest('label').classList.toggle('is-invalid', phoneDigits.length !== 11);

  if (nameInput.value.trim().length < 2) isValid = false;
  if (phoneDigits.length !== 11) isValid = false;
  if (!privacy.checked) {
    isValid = false;
    privacy.focus();
  }

  if (!isValid) {
    form.querySelector('.is-invalid input')?.focus();
    return;
  }

  if (honeypot.value) return;

  const submitButton = form.querySelector('.button--submit');
  submitButton.disabled = true;
  submitButton.style.opacity = '0.65';
  submitButton.setAttribute('aria-busy', 'true');

  const submissionId = form.dataset.submissionId || createSubmissionId();
  form.dataset.submissionId = submissionId;

  try {
    const metrikaIdentifiers = (await Promise.resolve(window.zrtLeadIdentifiers?.get?.())
      .catch(() => null)) || { client_id: null, yclid: null };
    if (!window.zrtLeadDelivery?.send) throw new Error('Lead delivery is unavailable');

    await window.zrtLeadDelivery.send({
      submission_id: submissionId,
      form_id: 'zrt-main-booking',
      source: 'adv.zrt-school.ru',
      page: `${window.location.origin}${window.location.pathname}`,
      scenario: body.dataset.scenario || 'beginner',
      name: nameInput.value.trim().slice(0, 100),
      phone: `+${phoneDigits}`,
      contact_method: form.elements.contact.value,
      privacy_accepted: true,
      attribution: getLeadAttribution(),
      metrika: metrikaIdentifiers
    });

    window.zrtMetrikaGoal?.('lead_sent', {
      scenario: body.dataset.scenario || 'beginner',
      contact_method: form.elements.contact.value
    });
    delete form.dataset.submissionId;
    form.reset();
    successMessage.hidden = false;
    successMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    showSubmissionError(error);
    submitButton.disabled = false;
    submitButton.style.opacity = '';
  } finally {
    submitButton.removeAttribute('aria-busy');
  }
});

(() => {
  const button = document.querySelector('#wa-float-button');
  if (!button) return;

  const phone = '79068486626';
  const baseText = 'Обращение из сайта\nЗдравствуйте! Меня заинтересовало ваше предложение.';
  function getUtmText() {
    const lines = Object.entries(getLeadAttribution()).map(([key, value]) => `${key}: ${value}`);

    return lines.length ? `\n\nUTM-метки:\n${lines.join('\n')}` : '';
  }

  button.addEventListener('click', () => {
    const finalText = baseText + getUtmText();
    button.href = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(finalText)}`;
  });
})();
