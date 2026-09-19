import test from 'node:test';
import assert from 'node:assert/strict';
import { rankConversations } from './conversationSearch.js';

const conversations = [
  { id: 1, name: 'Travel notes' },
  { id: 2, name: 'Home improvements' },
  { id: 3, name: 'Find that chat' },
];
const messages = [
  { id: 1, conversationId: 1, role: 'user', text: 'In Japan the sidewalks felt incredibly narrow.' },
  { id: 2, conversationId: 2, role: 'user', text: 'Our sidewalk needs repairs.' },
  { id: 3, conversationId: 3, role: 'user', text: 'In which convo did I talk about Japan narrow sidewalks?' },
];

test('ranks the topic above partial matches and excludes the current question', () => {
  const results = rankConversations(conversations, messages, ['Japan narrow sidewalk'], 3);
  assert.equal(results[0].conversationId, 1);
  assert.equal(results[0].url, '/chats/1');
  assert.equal(results[0].excerpts[0].role, 'user');
  assert.ok(!results.some(result => result.conversationId === 3));
});

test('alternate model-generated wording finds a paraphrase', () => {
  const results = rankConversations(conversations, [
    { id: 4, conversationId: 1, role: 'user', text: 'Japanese pavements leave little room for pedestrians.' },
  ], ['Japan narrow sidewalk', 'Japanese pavement'], 3);
  assert.equal(results[0].conversationId, 1);
});

test('combines context across messages and the title', () => {
  const results = rankConversations(conversations, [
    { id: 4, conversationId: 1, role: 'user', text: 'I visited Japan.' },
    { id: 5, conversationId: 1, role: 'user', text: 'The sidewalks were narrow.' },
    messages[1],
  ], ['Japan narrow sidewalk'], 3);
  assert.equal(results[0].conversationId, 1);
  assert.equal(results[0].excerpts.length, 2);
  assert.equal(rankConversations(conversations, [], ['Travel notes'], 3)[0].conversationId, 1);
});

test('returns no invented results for absent topics or empty queries', () => {
  assert.deepEqual(rankConversations(conversations, messages, ['penguin']), []);
  assert.deepEqual(rankConversations(conversations, messages, ['   ']), []);
});

test('long-message excerpts include the matching passage and stay bounded', () => {
  const results = rankConversations(conversations, [
    { id: 6, conversationId: 1, role: 'user', text: 'Unrelated text. '.repeat(500) + 'Japan narrow sidewalk' },
  ], ['Japan narrow sidewalk']);
  assert.match(results[0].excerpts[0].text, /Japan narrow sidewalk/);
  assert.ok(results[0].excerpts[0].text.length <= 1002);
});
