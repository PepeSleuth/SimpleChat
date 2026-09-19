export function conversationTitle(messages, fallback = 'New conversation') {
  const latest = messages.findLast(message => message.role === 'user');
  if (!latest) return fallback;
  const text = (latest.text ?? '').replace(/\s+/gu, ' ').trim() || 'Attachment message';
  const characters = Array.from(text);
  return characters.length > 80 ? `${characters.slice(0, 79).join('').trimEnd()}…` : text;
}
