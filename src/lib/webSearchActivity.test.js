import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebSearchActivity } from './webSearchActivity.js';

test('usage-only searches appear, repeated usage is not double-counted, steps add up', () => {
  const activity = createWebSearchActivity();
  activity.consume({ type: 'start-step' });
  const usage = { type: 'raw', rawValue: { usage: { server_tool_use: { web_search_requests: 2 } } } };
  assert.equal(activity.consume(usage).name, 'web_search');
  activity.consume(usage);
  assert.equal(activity.totalRequests, 2);
  assert.equal(activity.consume({ type: 'finish-step' }).status, 'complete');
  activity.consume({ type: 'start-step' });
  activity.consume(usage);
  assert.equal(activity.totalRequests, 4);
});

test('does not fabricate searches or queries and deduplicates citations', () => {
  const activity = createWebSearchActivity();
  assert.equal(activity.consume({ type: 'finish-step' }), null);
  const source = { type: 'source', sourceType: 'url', url: 'https://example.com', title: 'Example' };
  activity.consume(source);
  const entry = activity.consume(source);
  assert.equal(entry.output.sources.length, 1);
  assert.equal(entry.input, undefined);
  assert.equal(activity.totalRequests, null);
});
