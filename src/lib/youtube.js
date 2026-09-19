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
