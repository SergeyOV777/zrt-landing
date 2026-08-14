(function (root, factory) {
  const helpers = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = helpers;
  }

  if (root?.document) {
    root.zrtLeadIdentifiers = helpers.create(root);
  }
})(typeof window !== 'undefined' ? window : null, function () {
  const COUNTER_ID = 32428555;
  const YCLID_STORAGE_KEY = 'zrt_yclid';
  const YCLID_MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000;
  const CLIENT_ID_TIMEOUT_MS = 800;

  function cleanIdentifier(value, maxLength = 200) {
    if (typeof value !== 'string') return null;
    const cleaned = value.trim();
    if (!cleaned || cleaned.length > maxLength) return null;
    return /^[A-Za-z0-9_-]+$/.test(cleaned) ? cleaned : null;
  }

  function parseStoredYclid(rawValue, now = Date.now()) {
    try {
      const stored = JSON.parse(rawValue);
      const value = cleanIdentifier(stored?.value);
      const capturedAt = Number(stored?.captured_at);
      if (!value || !Number.isFinite(capturedAt)) return null;
      if (capturedAt > now || now - capturedAt > YCLID_MAX_AGE_MS) return null;
      return value;
    } catch {
      return null;
    }
  }

  function create(browser) {
    function rememberYclid() {
      const fromUrl = cleanIdentifier(new URLSearchParams(browser.location.search).get('yclid'));
      if (!fromUrl) return;

      try {
        browser.localStorage.setItem(
          YCLID_STORAGE_KEY,
          JSON.stringify({ value: fromUrl, captured_at: Date.now() })
        );
      } catch {
        // Заявка продолжает работать, даже если локальное хранилище отключено.
      }
    }

    function getYclid() {
      const fromUrl = cleanIdentifier(new URLSearchParams(browser.location.search).get('yclid'));
      if (fromUrl) return fromUrl;

      try {
        return parseStoredYclid(browser.localStorage.getItem(YCLID_STORAGE_KEY));
      } catch {
        return null;
      }
    }

    function getClientId() {
      return new Promise((resolve) => {
        if (typeof browser.ym !== 'function') {
          resolve(null);
          return;
        }

        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          browser.clearTimeout(timeoutId);
          resolve(cleanIdentifier(value));
        };
        const timeoutId = browser.setTimeout(() => finish(null), CLIENT_ID_TIMEOUT_MS);

        try {
          browser.ym(COUNTER_ID, 'getClientID', finish);
        } catch {
          finish(null);
        }
      });
    }

    rememberYclid();

    return {
      async get() {
        const [clientId, yclid] = await Promise.all([
          getClientId().catch(() => null),
          Promise.resolve(getYclid())
        ]);

        return {
          client_id: clientId,
          yclid
        };
      }
    };
  }

  return {
    cleanIdentifier,
    parseStoredYclid,
    create
  };
});
