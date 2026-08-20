(() => {
  const counterId = 3788569;

  function reachGoal(goal) {
    try {
      const tmr = window._tmr || (window._tmr = []);
      tmr.push({ type: 'reachGoal', id: counterId, goal });
    } catch (error) {
      // Сбой рекламного пикселя не должен мешать действию пользователя.
    }
  }

  document.addEventListener('click', (event) => {
    const scenarioTarget = event.target.closest('[data-scenario-select]');
    const scenario = scenarioTarget?.dataset.scenarioSelect;
    if (scenario === 'beginner') {
      reachGoal('scenarioBeginner');
      return;
    }
    if (scenario === 'experienced') {
      reachGoal('scenarioExperienced');
      return;
    }

    const target = event.target.closest('a[href]');
    if (!target) return;

    const href = (target.getAttribute('href') || '').toLowerCase();
    if (href.includes('t.me/')) {
      reachGoal('telegramClick');
    } else if (href.includes('api.whatsapp.com') || href.includes('wa.me/')) {
      reachGoal('whatsappClick');
    } else if (href.includes('max.ru/')) {
      reachGoal('maxClick');
    }
  });
})();
