const DB_NAME = 'SimpleChat';
const DB_VERSION = 1;

const STORE = {
  settings: 'settings',
  conversations: 'conversations',
  messages: 'messages',
  attachments: 'attachments',
};

let dbPromise = null;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
  });
}

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE.settings)) {
        db.createObjectStore(STORE.settings, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(STORE.conversations)) {
        db.createObjectStore(STORE.conversations, { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains(STORE.messages)) {
        const messages = db.createObjectStore(STORE.messages, { keyPath: 'id', autoIncrement: true });
        messages.createIndex('conversationId', 'conversationId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE.attachments)) {
        const attachments = db.createObjectStore(STORE.attachments, { keyPath: 'id', autoIncrement: true });
        attachments.createIndex('conversationId', 'conversationId', { unique: false });
        attachments.createIndex('messageId', 'messageId', { unique: false });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });

  return dbPromise;
}

async function withTransaction(storeNames, mode, handler) {
  const db = await openDatabase();
  const transaction = db.transaction(storeNames, mode);
  const result = await handler(transaction);
  await transactionDone(transaction);
  return result;
}

async function getSetting(key) {
  const db = await openDatabase();
  const tx = db.transaction(STORE.settings, 'readonly');
  const request = tx.objectStore(STORE.settings).get(key);
  return requestToPromise(request);
}

async function setSetting(key, value) {
  await withTransaction(STORE.settings, 'readwrite', tx => tx.objectStore(STORE.settings).put({ key, value }));
}

async function listConversations() {
  const db = await openDatabase();
  const tx = db.transaction(STORE.conversations, 'readonly');
  const request = tx.objectStore(STORE.conversations).getAll();
  const conversations = await requestToPromise(request);
  return conversations.sort((a, b) => a.id - b.id);
}

async function getConversation(conversationId) {
  const db = await openDatabase();
  const tx = db.transaction(STORE.conversations, 'readonly');
  const request = tx.objectStore(STORE.conversations).get(conversationId);
  return requestToPromise(request);
}

async function createConversation(name) {
  const now = new Date().toISOString();
  return withTransaction(STORE.conversations, 'readwrite', async tx => {
    const conversation = {
      name,
      createdAt: now,
      updatedAt: now,
    };
    const id = await requestToPromise(tx.objectStore(STORE.conversations).add(conversation));
    return { id, ...conversation };
  });
}

async function renameConversation(conversationId, name) {
  return withTransaction(STORE.conversations, 'readwrite', async tx => {
    const store = tx.objectStore(STORE.conversations);
    const conversation = await requestToPromise(store.get(conversationId));
    if (!conversation) return null;
    const updated = { ...conversation, name, updatedAt: new Date().toISOString() };
    await requestToPromise(store.put(updated));
    return updated;
  });
}

async function deleteConversation(conversationId) {
  const db = await openDatabase();
  const transaction = db.transaction([STORE.conversations, STORE.messages, STORE.attachments], 'readwrite');
  const conversationStore = transaction.objectStore(STORE.conversations);
  const messageStore = transaction.objectStore(STORE.messages);
  const attachmentStore = transaction.objectStore(STORE.attachments);
  const messageIndex = messageStore.index('conversationId');
  const attachmentIndex = attachmentStore.index('conversationId');

  const messages = await requestToPromise(messageIndex.getAll(conversationId));
  const attachments = await requestToPromise(attachmentIndex.getAll(conversationId));

  for (const attachment of attachments) {
    attachmentStore.delete(attachment.id);
  }

  for (const message of messages) {
    messageStore.delete(message.id);
  }

  conversationStore.delete(conversationId);
  await transactionDone(transaction);
}

async function loadConversationMessages(conversationId) {
  const db = await openDatabase();
  const tx = db.transaction([STORE.messages, STORE.attachments], 'readonly');
  const messageStore = tx.objectStore(STORE.messages);
  const attachmentStore = tx.objectStore(STORE.attachments);
  const messages = await requestToPromise(messageStore.index('conversationId').getAll(conversationId));
  const attachments = await requestToPromise(attachmentStore.index('conversationId').getAll(conversationId));

  const attachmentsByMessageId = new Map();
  for (const attachment of attachments) {
    const list = attachmentsByMessageId.get(attachment.messageId) ?? [];
    list.push(attachment);
    attachmentsByMessageId.set(attachment.messageId, list);
  }

  return messages
    .sort((a, b) => a.id - b.id)
    .map(message => ({
      id: message.id,
      role: message.role,
      text: message.text ?? '',
      stats: message.stats ?? null,
      createdAt: message.createdAt ?? null,
      attachments: (attachmentsByMessageId.get(message.id) ?? [])
        .sort((a, b) => a.id - b.id)
        .map(attachment => ({
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
          kind: attachment.kind,
          blob: attachment.blob,
        })),
    }));
}

async function appendMessage({ conversationId, role, text, stats = null, attachments = [] }) {
  const now = new Date().toISOString();
  return withTransaction([STORE.conversations, STORE.messages, STORE.attachments], 'readwrite', async tx => {
    const conversationStore = tx.objectStore(STORE.conversations);
    const messageStore = tx.objectStore(STORE.messages);
    const attachmentStore = tx.objectStore(STORE.attachments);

    const messageId = await requestToPromise(messageStore.add({
      conversationId,
      role,
      text,
      stats,
      createdAt: now,
    }));

    for (const attachment of attachments) {
      await requestToPromise(attachmentStore.add({
        conversationId,
        messageId,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        kind: attachment.kind,
        blob: attachment.blob,
      }));
    }

    const conversation = await requestToPromise(conversationStore.get(conversationId));
    if (conversation) {
      await requestToPromise(conversationStore.put({
        ...conversation,
        updatedAt: now,
      }));
    }

    return { id: messageId, conversationId, role, text, stats, createdAt: now };
  });
}

async function duplicateConversationFromMessages({ name, messages }) {
  const now = new Date().toISOString();
  return withTransaction([STORE.conversations, STORE.messages, STORE.attachments], 'readwrite', async tx => {
    const conversationStore = tx.objectStore(STORE.conversations);
    const messageStore = tx.objectStore(STORE.messages);
    const attachmentStore = tx.objectStore(STORE.attachments);

    const conversationId = await requestToPromise(conversationStore.add({
      name,
      createdAt: now,
      updatedAt: now,
    }));

    for (const message of messages) {
      const messageId = await requestToPromise(messageStore.add({
        conversationId,
        role: message.role,
        text: message.text ?? '',
        stats: message.stats ?? null,
        createdAt: message.createdAt ?? now,
      }));

      for (const attachment of message.attachments ?? []) {
        await requestToPromise(attachmentStore.add({
          conversationId,
          messageId,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
          kind: attachment.kind,
          blob: attachment.blob,
        }));
      }
    }

    return { id: conversationId, name, createdAt: now, updatedAt: now };
  });
}

async function loadAppState() {
  let conversations = await listConversations();

  if (!conversations.length) {
    const created = await createConversation('Conversation 1');
    conversations = [created];
  }

  const settings = {
    apiKey: (await getSetting('apiKey'))?.value ?? '',
    model: (await getSetting('model'))?.value ?? '',
    reasoningEffort: (await getSetting('reasoningEffort'))?.value ?? null,
    webSearchEnabled: (await getSetting('webSearchEnabled'))?.value ?? false,
    currentConversationId: (await getSetting('currentConversationId'))?.value ?? null,
  };

  const firstConversation = conversations[0];
  const currentConversationId = conversations.some(conv => conv.id === settings.currentConversationId)
    ? settings.currentConversationId
    : firstConversation.id;

  const messages = await loadConversationMessages(currentConversationId);

  if (settings.currentConversationId !== currentConversationId) {
    await setSetting('currentConversationId', currentConversationId);
    settings.currentConversationId = currentConversationId;
  }

  if (settings.model == null) settings.model = '';
  if (settings.reasoningEffort == null) settings.reasoningEffort = null;
  if (settings.webSearchEnabled == null) settings.webSearchEnabled = false;

  return {
    conversations,
    currentConversationId,
    messages,
    settings,
  };
}

export {
  appendMessage,
  createConversation,
  deleteConversation,
  duplicateConversationFromMessages,
  loadAppState,
  loadConversationMessages,
  renameConversation,
  setSetting,
};
