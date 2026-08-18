(function (root, factory) {
  const helpers = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = helpers;
  }

  if (root?.document) {
    root.zrtLeadDelivery = helpers.create(root);
  }
})(typeof window !== 'undefined' ? window : null, function () {
  const DEFAULT_ENDPOINTS = [
    { url: 'https://api.zrt-school.ru/v1/leads', timeoutMs: 5_000 },
    { url: 'https://zrt-amocrm-lead-receiver.magniffique.workers.dev/v1/leads', timeoutMs: 15_000 }
  ];
  const PROCESSING_RETRY_DELAYS_MS = [1_000, 1_500, 2_500, 3_500];

  class LeadDeliveryError extends Error {
    constructor(code, { status = 0, cause } = {}) {
      super(code);
      this.name = 'LeadDeliveryError';
      this.code = code;
      this.status = status;
      if (cause) this.cause = cause;
    }
  }

  function isRetryableResponse(status, code) {
    return code === 'invalid_response'
      || status === 404
      || status === 405
      || status === 408
      || status === 425
      || status >= 500;
  }

  function create(browser, { endpoints = DEFAULT_ENDPOINTS } = {}) {
    const normalizedEndpoints = endpoints
      .filter((endpoint) => endpoint?.url)
      .map((endpoint) => ({
        url: String(endpoint.url),
        timeoutMs: Number(endpoint.timeoutMs) > 0 ? Number(endpoint.timeoutMs) : 15_000
      }));

    async function wait(delayMs) {
      await new Promise((resolve) => browser.setTimeout(resolve, delayMs));
    }

    async function post(endpoint, body) {
      const controller = new browser.AbortController();
      const timeoutId = browser.setTimeout(() => controller.abort(), endpoint.timeoutMs);

      try {
        const response = await browser.fetch(endpoint.url, {
          method: 'POST',
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json'
          },
          body,
          signal: controller.signal
        });
        const result = await response.json().catch(() => null);
        return { response, result };
      } catch (error) {
        const code = error?.name === 'AbortError' ? 'delivery_timeout' : 'delivery_network_error';
        throw new LeadDeliveryError(code, { cause: error });
      } finally {
        browser.clearTimeout(timeoutId);
      }
    }

    async function send(payload) {
      if (!normalizedEndpoints.length) throw new LeadDeliveryError('delivery_not_configured');

      const body = JSON.stringify(payload);
      let lastError = new LeadDeliveryError('delivery_network_error');

      for (const endpoint of normalizedEndpoints) {
        let processingRetry = 0;

        while (true) {
          let delivery;
          try {
            delivery = await post(endpoint, body);
          } catch (error) {
            lastError = error instanceof LeadDeliveryError
              ? error
              : new LeadDeliveryError('delivery_network_error', { cause: error });
            break;
          }

          const { response, result } = delivery;
          if (response.ok && result?.ok === true) return result;

          const code = typeof result?.code === 'string'
            ? result.code
            : (response.ok ? 'invalid_response' : `http_${response.status}`);
          const responseError = new LeadDeliveryError(code, { status: response.status });

          if (code === 'already_processing' && processingRetry < PROCESSING_RETRY_DELAYS_MS.length) {
            await wait(PROCESSING_RETRY_DELAYS_MS[processingRetry]);
            processingRetry += 1;
            continue;
          }

          if (isRetryableResponse(response.status, code)) {
            lastError = responseError;
            break;
          }

          throw responseError;
        }
      }

      throw lastError;
    }

    return { send };
  }

  return {
    DEFAULT_ENDPOINTS,
    LeadDeliveryError,
    isRetryableResponse,
    create
  };
});
