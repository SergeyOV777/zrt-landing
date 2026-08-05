(() => {
  const counterId = 32428555;

  (function (m, e, t, r, i, k, a) {
    m[i] = m[i] || function () {
      (m[i].a = m[i].a || []).push(arguments);
    };
    m[i].l = 1 * new Date();
    k = e.createElement(t);
    a = e.getElementsByTagName(t)[0];
    k.async = true;
    k.src = r;
    a.parentNode.insertBefore(k, a);
  })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');

  window.ym(counterId, 'init', {
    accurateTrackBounce: true,
    clickmap: true,
    trackLinks: true
  });

  window.zrtMetrikaGoal = (goal, params) => {
    if (typeof window.ym === 'function') {
      window.ym(counterId, 'reachGoal', goal, params);
    }
  };

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-scenario-select], a[href]');
    if (!target) return;

    const scenario = target.dataset.scenarioSelect;
    if (scenario === 'beginner' || scenario === 'experienced') {
      window.zrtMetrikaGoal(`scenario_${scenario}`);
      return;
    }

    const href = (target.getAttribute('href') || '').toLowerCase();
    if (href.startsWith('tel:')) {
      window.zrtMetrikaGoal('phone_click');
    } else if (href.includes('t.me/')) {
      window.zrtMetrikaGoal('telegram_click');
    } else if (href.includes('api.whatsapp.com') || href.includes('wa.me/')) {
      window.zrtMetrikaGoal('whatsapp_click');
    } else if (href.includes('max.ru/')) {
      window.zrtMetrikaGoal('max_click');
    }
  });
})();
