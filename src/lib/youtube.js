export function youtubeVideoParts(text, enabled = false) {
  if (!enabled) return [];
  const ids = new Set();
  for (const match of (text ?? '').matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    try {
      const url = new URL(match[0].replace(/[).,;!?\]}]+$/g, ''));
      const host = url.hostname.toLowerCase();
      let id;
      if (host === 'youtu.be') id = url.pathname.split('/')[1];
      else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
        id = url.pathname === '/watch' ? url.searchParams.get('v')
          : /^\/(shorts|embed|live)\//.test(url.pathname) ? url.pathname.split('/')[2] : null;
      }
      if (id && /^[\w-]{11}$/.test(id)) ids.add(id);
    } catch { /* Ignore malformed links. */ }
  }
  return [...ids].map(id => ({
    type: 'file', mediaType: 'video/mp4',
    data: new URL(`https://www.youtube.com/watch?v=${id}`),
  }));
}

// The provider converts video file parts to video_url, but does not advertise
// video URLs to the AI SDK. Pass these through instead of downloading HTML.
export function enableYouTubeUrls(model) {
  model.supportedUrls = {
    ...model.supportedUrls,
    'video/*': [/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/],
  };
  return model;
}

// Only Google AI Studio accepts YouTube URLs; Vertex rejects video URLs, so
// requests containing one must not be load-balanced onto it.
export const youtubeProviderRouting = { only: ['google-ai-studio'], allow_fallbacks: false };

export function hasYouTubeVideo(messages) {
  return messages.some(message => Array.isArray(message.content) && message.content.some(part =>
    part.type === 'file' && part.data instanceof URL && part.data.hostname === 'www.youtube.com'));
}
