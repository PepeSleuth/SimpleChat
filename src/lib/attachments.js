export function isImageMimeType(mimeType = '') {
  return mimeType.startsWith('image/');
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Failed to read attachment'));
    reader.readAsDataURL(blob);
  });
}

export function createAttachmentPreview(attachment) {
  return {
    ...attachment,
    previewUrl: attachment.kind === 'image' ? URL.createObjectURL(attachment.blob) : null,
  };
}

export function hydrateMessages(rawMessages = []) {
  return rawMessages.map(message => ({
    ...message,
    attachments: (message.attachments ?? []).map(createAttachmentPreview),
  }));
}

export function releaseAttachmentUrls(messages = []) {
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}

export function makeDraftAttachment(file) {
  const mimeType = file.type || 'application/octet-stream';
  const kind = isImageMimeType(mimeType) ? 'image' : 'file';
  return {
    id: (crypto.randomUUID?.() ?? `${file.name}-${file.lastModified}-${file.size}-${Math.random().toString(36).slice(2)}`),
    name: file.name,
    size: file.size,
    mimeType,
    kind,
    blob: file,
    previewUrl: kind === 'image' ? URL.createObjectURL(file) : null,
  };
}

export async function attachmentToPart(attachment) {
  const dataUrl = await blobToDataUrl(attachment.blob);

  if (attachment.kind === 'image') {
    return {
      type: 'image',
      image: dataUrl,
      mediaType: attachment.mimeType,
    };
  }

  return {
    type: 'file',
    data: dataUrl,
    mediaType: attachment.mimeType,
    filename: attachment.name,
  };
}
