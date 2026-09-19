import test from 'node:test';
import assert from 'node:assert/strict';
import { requestError, retryRequest, waitForRetry } from './requestRetry.js';

test('credit errors surface the provider detail and do not retry', async () => {
  let calls = 0;
  await assert.rejects(retryRequest(async () => {
    calls++;
    throw { statusCode: 402, responseBody: JSON.stringify({ error: { message: 'Insufficient credits' } }) };
  }), /402.*Insufficient credits.*Add credits/);
  assert.equal(calls, 1);
});

test('temporary failures retry twice with backoff and clear UI status', async () => {
  const delays = [], statuses = [];
  let calls = 0;
  const result = await retryRequest(async () => {
    if (++calls < 3) throw new TypeError('Failed to fetch');
    return 'response';
  }, { wait: async ms => delays.push(ms), onStatus: status => statuses.push(status) });
  assert.equal(result, 'response');
  assert.deepEqual(delays, [1000, 2000]);
  assert.match(statuses[0], /Failed to fetch.*1\/2/);
  assert.equal(statuses.at(-1), '');
});

test('exhausted retries retain partial output and the final error', async () => {
  let calls = 0;
  await assert.rejects(retryRequest(async () => {
    calls++;
    const error = new Error('The response stream ended incomplete.');
    if (calls === 1) error.partialResponse = { text: 'Partial answer', stats: {} };
    throw error;
  }, { wait: async () => {} }), error => {
    assert.equal(error.partialResponse.text, 'Partial answer');
    assert.match(error.partialResponse.stats.error, /incomplete/);
    return true;
  });
  assert.equal(calls, 3);
});

test('rate-limit retry-after is honored and bounded', async () => {
  const delays = [];
  await assert.rejects(retryRequest(async () => {
    throw { statusCode: 429, message: 'Slow down', responseHeaders: { 'retry-after': '120' } };
  }, { wait: async ms => delays.push(ms) }), /429/);
  assert.deepEqual(delays, [30000, 30000]);
});

test('Stop cancels retry backoff immediately without another attempt', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(retryRequest(async () => {
    calls++;
    throw new Error('Network error');
  }, { signal: controller.signal, onStatus: status => { if (status) controller.abort(); } }), { name: 'AbortError' });
  assert.equal(calls, 1);
  const other = new AbortController();
  const waiting = waitForRetry(30000, other.signal);
  other.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
});

test('stream error objects and authentication failures remain useful', () => {
  assert.match(requestError({ code: 402, message: 'Payment required' }).message, /Add credits/);
  assert.equal(requestError({ statusCode: 401, message: 'Invalid key' }).isRetryable, false);
  assert.equal(requestError({ statusCode: 400, message: 'Bad request' }).isRetryable, false);
  assert.equal(requestError({ statusCode: 503, message: 'Unavailable' }).isRetryable, true);
});
