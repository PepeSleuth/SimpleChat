export function requestError(error) {
  if (error?.isRequestError) return error;
  let body;
  try { body = JSON.parse(error?.responseBody); } catch { /* Not a JSON response. */ }
  const detail = body?.error ?? error?.error ?? error?.lastError ?? error;
  const status = Number(detail?.code ?? detail?.statusCode ?? error?.statusCode) || null;
  const message = (typeof detail === 'string' ? detail : detail?.message) || error?.message || 'The request failed without an error message.';
  const hints = {
    401: 'Check your OpenRouter API key.',
    402: 'Add credits to your OpenRouter account or check your key’s spending limit.',
    403: 'Check your API key permissions and model access.',
    429: 'OpenRouter is rate limiting requests. Please try again shortly.',
  };
  const normalized = new Error([status ? `OpenRouter (${status}): ${message}` : message, hints[status]].filter(Boolean).join(' '));
  normalized.isRequestError = true;
  normalized.statusCode = status;
  normalized.name = error?.name === 'AbortError' ? 'AbortError' : 'Error';
  normalized.isRetryable = status != null
    ? [408, 429, 500, 502, 503, 504, 524, 529].includes(status)
    : error?.isRetryable === true || error?.name === 'TimeoutError' || /network|fetch failed|failed to fetch|connection|terminated|timed? ?out|incomplete|stream.*(closed|ended|interrupted)/i.test(message);
  normalized.partialResponse = error?.partialResponse;
  const retryAfter = error?.responseHeaders?.['retry-after'];
  const seconds = Number(retryAfter);
  normalized.retryAfterMs = retryAfter == null ? (error?.retryAfterMs ?? 0) : Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
  return normalized;
}

export function waitForRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function retryRequest(run, { signal, onStatus, wait = waitForRetry } = {}) {
  let partialResponse;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted();
      try {
        return await run();
      } catch (cause) {
        if (signal?.aborted) throw signal.reason;
        const error = requestError(cause);
        partialResponse = error.partialResponse ?? partialResponse;
        if (partialResponse) error.partialResponse = { ...partialResponse, stats: { ...partialResponse.stats, error: error.message } };
        if (error.name === 'AbortError' || !error.isRetryable || attempt === 2) throw error;
        const delay = Math.min(30000, Math.max(1000 * 2 ** attempt, error.retryAfterMs));
        onStatus?.(`${error.message} Retrying in ${Math.ceil(delay / 1000)}s (${attempt + 1}/2)…`);
        await wait(delay, signal);
        onStatus?.(`Retrying request (${attempt + 1}/2)…`);
      }
    }
  } finally {
    onStatus?.('');
  }
}
