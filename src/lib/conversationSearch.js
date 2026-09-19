// Keep retrieval local and cheap. The model supplies alternate wording when needed.
function words(text) {
  return (text ?? '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function matches(word, term) {
  return word === term || (term.length >= 4 && word.startsWith(term));
}

export function rankConversations(conversations, messages, queries, excludeConversationId) {
  const groups = queries.map(words).filter(group => group.length);
  if (!groups.length) return [];
  const byConversation = new Map();
  for (const message of messages) {
    if (message.conversationId === excludeConversationId || !message.text) continue;
    const entries = byConversation.get(message.conversationId) ?? [];
    entries.push(message);
    byConversation.set(message.conversationId, entries);
  }
  return conversations.filter(c => c.id !== excludeConversationId).map(conversation => {
    const entries = byConversation.get(conversation.id) ?? [];
    const titleWords = words(conversation.name);
    const scored = entries.map(message => {
      const tokens = words(message.text);
      const score = Math.max(...groups.map(terms => {
        const hits = terms.filter(term => tokens.some(word => matches(word, term))).length;
        return hits ? hits / terms.length + (hits === terms.length ? 1 : 0) : 0;
      }));
      return { message, score };
    }).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score || a.message.id - b.message.id);
    const allWords = new Set([...titleWords, ...entries.flatMap(m => words(m.text))]);
    const coverage = Math.max(...groups.map(terms => {
      const hits = terms.filter(term => [...allWords].some(word => matches(word, term))).length;
      return hits ? hits / terms.length + (hits === terms.length ? 1 : 0) : 0;
    }));
    const score = coverage + (scored[0]?.score ?? 0);
    const terms = groups.flat();
    return {
      conversationId: conversation.id,
      title: conversation.name,
      url: `/chats/${conversation.id}`,
      updatedAt: conversation.updatedAt,
      score,
      excerpts: scored.slice(0, 4).map(({ message }) => {
        const lower = message.text.normalize('NFKC').toLowerCase();
        const positions = terms.map(term => lower.indexOf(term)).filter(index => index >= 0);
        const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 200);
        const end = Math.min(message.text.length, start + 1000);
        return { messageId: message.id, role: message.role, text: `${start ? '…' : ''}${message.text.slice(start, end)}${end < message.text.length ? '…' : ''}` };
      }),
    };
  }).filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || b.conversationId - a.conversationId)
    .slice(0, 8);
}
