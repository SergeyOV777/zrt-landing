(() => {
  const goalId = 'calltouch_callback';

  if (typeof window.ct !== 'function') return;

  try {
    window.ct('modules', 'widgets', 'subscribeToEvent', [{
      object: 'request',
      action: 'create',
      callback(event) {
        const data = event?.data;
        if (event?.object !== 'request' || event?.action !== 'create') return;
        if (data?.widgetType !== 'callback') return;

        const params = { widget_type: 'callback' };
        if (typeof data.workMode === 'string') params.work_mode = data.workMode;
        if (typeof data.actionType === 'string') params.action_type = data.actionType;

        window.zrtMetrikaGoal?.(goalId, params);
      }
    }]);
  } catch (error) {
    // Сбой аналитики Calltouch не должен мешать работе виджета.
  }
})();
