import test from 'node:test';
import assert from 'node:assert/strict';
import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { youtubeVideoParts, enableYouTubeUrls } from './youtube.js';
import { createWebSearchActivity } from './webSearchActivity.js';

const id = 'dQw4w9WgXcQ';
const url = `https://www.youtube.com/watch?v=${id}`;

test('YouTube is opt-in and accepts common links without duplicates', () => {
  assert.deepEqual(youtubeVideoParts(url), []);
  const parts = youtubeVideoParts(`Watch [this](${url}&t=12). Also https://youtu.be/${id}?si=abc and https://m.youtube.com/shorts/${id}`, true);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].data.href, url);
  assert.equal(youtubeVideoParts(`https://www.youtube.com/live/${id}`, true).length, 1);
  assert.equal(youtubeVideoParts(`https://www.youtube.com/embed/${id}`, true).length, 1);
});

test('unrelated, spoofed, channel, and invalid URLs are not video attachments', () => {
  assert.deepEqual(youtubeVideoParts(`https://youtube.com.evil.test/watch?v=${id} https://youtube.com/@channel https://youtube.com/watch?v=bad https://example.com/${id}`, true), []);
});

test('SDK sends video_url without downloading YouTube and exposes server search activity', async () => {
  let body;
  let calls = 0;
  const router = createOpenRouter({ apiKey: 'test', fetch: async (_url, options) => {
    calls++;
    body = JSON.parse(options.body);
    const chunks = [
      { choices: [{ index: 0, delta: { content: 'Answer', annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.com', title: 'Source' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, server_tool_use: { web_search_requests: 2 } } },
    ];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  const result = streamText({
    model: enableYouTubeUrls(router('google/test')),
    messages: [{ role: 'user', content: [{ type: 'text', text: url }, ...youtubeVideoParts(url, true)] }],
    tools: { web_search: router.tools.webSearch({}) },
    includeRawChunks: true,
    maxRetries: 0,
  });
  const activity = createWebSearchActivity();
  let search;
  for await (const chunk of result.fullStream) {
    if (chunk.type === 'error') throw chunk.error;
    search = activity.consume(chunk) ?? search;
  }
  assert.equal(calls, 1);
  assert.deepEqual(body.messages[0].content[1], { type: 'video_url', video_url: { url } });
  assert.ok(body.tools.some(tool => tool.type === 'openrouter:web_search'));
  assert.equal(search.status, 'complete');
  assert.equal(search.output.sources[0].url, 'https://example.com');
  assert.equal(activity.totalRequests, 2);
});
