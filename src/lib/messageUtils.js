import { attachmentToPart } from './attachments';

export function formatCost(cost) {
  if (cost == null) return null;
  const value = typeof cost === 'string' ? Number(cost) : cost;
  if (!Number.isFinite(value)) return null;
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(4)}`;
}

export async function messagesToModelMessages(messages) {
  const modelMessages = [];

  for (const message of messages) {
    if (message.role === 'assistant') {
      modelMessages.push({ role: 'assistant', content: message.text ?? '' });
      continue;
    }

    const parts = [];
    if (message.text) {
      parts.push({ type: 'text', text: message.text });
    }

    const attachmentParts = await Promise.all((message.attachments ?? []).map(attachmentToPart));
    parts.push(...attachmentParts);

    modelMessages.push(
      parts.length === 1 && parts[0].type === 'text'
        ? { role: 'user', content: parts[0].text }
        : { role: 'user', content: parts }
    );
  }

  return modelMessages;
}

export function createOpenRouterTools(openrouter) {
  return {
    web_search: openrouter.tools.webSearch({}),
  };
}
