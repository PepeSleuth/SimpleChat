// Server-side searches may expose citations/usage without SDK tool-call events.
// Keep one honest summary per model step; queries are not always supplied.
export function createWebSearchActivity() {
  let step = 0;
  let count = 0;
  let completed = false;
  let sources = new Map();
  const counts = new Map();
  return {
    get totalRequests() {
      return counts.size ? [...counts.values()].reduce((sum, value) => sum + value, 0) : null;
    },
    consume(chunk) {
      if (chunk.type === 'start-step') {
        step++;
        count = 0;
        completed = false;
        sources = new Map();
        return null;
      }
      if (chunk.type === 'raw') {
        const value = chunk.rawValue?.usage?.server_tool_use?.web_search_requests;
        if (Number.isFinite(value) && value >= 0) {
          count = Math.max(count, value);
          counts.set(step, count);
        } else return null;
      } else if (chunk.type === 'source' && chunk.sourceType === 'url') {
        sources.set(chunk.url, {
          title: chunk.title, url: chunk.url,
          ...(chunk.providerMetadata?.openrouter?.content ? { content: chunk.providerMetadata.openrouter.content } : {}),
        });
      } else if (chunk.type === 'finish-step') {
        completed = true;
      } else return null;
      if (!count && !sources.size) return null;
      return {
        id: `server-web-search-${step}`,
        name: 'web_search',
        status: completed ? 'complete' : 'running',
        output: {
          ...(count ? { searches: count } : {}),
          note: 'Search performed by OpenRouter. Individual queries are not provided.',
          sources: [...sources.values()],
        },
      };
    },
  };
}
