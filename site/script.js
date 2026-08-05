const body = document.body;
const scenarioButtons = [...document.querySelectorAll("[data-scenario-select]")];
const variants = [...document.querySelectorAll("[data-variant]")];

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

form?.addEventListener('submit', (event) => {
  event.preventDefault();

  const nameInput = form.elements.name;
  const phone = form.elements.phone;
  const privacy = form.elements.privacy;
  const phoneDigits = phone.value.replace(/\D/g, '');
  let isValid = true;

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

  const submitButton = form.querySelector('.button--submit');
  submitButton.disabled = true;
  submitButton.style.opacity = '0.65';
  successMessage.hidden = false;
  successMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

(() => {
  const button = document.querySelector('#wa-float-button');
  if (!button) return;

  const phone = '79068486626';
  const baseText = 'Обращение из сайта\nЗдравствуйте! Меня заинтересовало ваше предложение.';
  const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  const params = new URLSearchParams(window.location.search);

  utmKeys.forEach((key) => {
    const value = params.get(key);
    if (!value) return;
    try {
      localStorage.setItem(`lead_${key}`, value);
    } catch (error) {
      // Ссылка остаётся рабочей, даже если локальное хранилище недоступно.
    }
  });

  function getUtmText() {
    const lines = [];

    utmKeys.forEach((key) => {
      try {
        const value = localStorage.getItem(`lead_${key}`);
        if (value) lines.push(`${key}: ${value}`);
      } catch (error) {
        // UTM-метки необязательны для открытия WhatsApp.
      }
    });

    return lines.length ? `\n\nUTM-метки:\n${lines.join('\n')}` : '';
  }

  function getMetrikaId() {
    if (window.mainMetrikaId) return window.mainMetrikaId;
    if (window.tildametrikaid) return window.tildametrikaid;

    for (const key in window) {
      if (/^yaCounter\d+$/.test(key)) return key.replace('yaCounter', '');
    }

    return null;
  }

  button.addEventListener('click', () => {
    const finalText = baseText + getUtmText();
    button.href = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(finalText)}`;

    if (typeof window.ym === 'function') {
      const counterId = getMetrikaId();
      if (counterId) window.ym(counterId, 'reachGoal', 'whatsapp_click');
    }
  });
})();
