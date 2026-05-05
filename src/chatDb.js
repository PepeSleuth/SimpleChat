const DB_NAME = 'SimpleChat';
const DB_VERSION = 2;
const DEFAULT_PROJECT_NAME = 'Unsorted';

const STORE = {
  settings: 'settings',
  projects: 'projects',
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
      const tx = request.transaction;
      const hadProjectsStore = db.objectStoreNames.contains(STORE.projects);
      const hadConversationsStore = db.objectStoreNames.contains(STORE.conversations);

      if (!db.objectStoreNames.contains(STORE.settings)) {
        db.createObjectStore(STORE.settings, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(STORE.projects)) {
        const projects = db.createObjectStore(STORE.projects, { keyPath: 'id', autoIncrement: true });
        projects.createIndex('isDefault', 'isDefault', { unique: false });
      } else {
        const projects = tx.objectStore(STORE.projects);
        if (!projects.indexNames.contains('isDefault')) {
          projects.createIndex('isDefault', 'isDefault', { unique: false });
        }
      }

      if (!db.objectStoreNames.contains(STORE.conversations)) {
        const conversations = db.createObjectStore(STORE.conversations, { keyPath: 'id', autoIncrement: true });
        conversations.createIndex('projectId', 'projectId', { unique: false });
      } else {
        const conversations = tx.objectStore(STORE.conversations);
        if (!conversations.indexNames.contains('projectId')) {
          conversations.createIndex('projectId', 'projectId', { unique: false });
        }
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

      if (!hadProjectsStore && hadConversationsStore) {
        const projects = tx.objectStore(STORE.projects);
        const conversations = tx.objectStore(STORE.conversations);
        const defaultProject = {
          name: DEFAULT_PROJECT_NAME,
          isDefault: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const projectRequest = projects.add(defaultProject);

        projectRequest.onsuccess = () => {
          const defaultProjectId = projectRequest.result;
          const cursorRequest = conversations.openCursor();
          cursorRequest.onsuccess = event => {
            const cursor = event.target.result;
            if (!cursor) return;
            const conversation = cursor.value;
            if (conversation.projectId == null) {
              cursor.update({
                ...conversation,
                projectId: defaultProjectId,
              });
            }
            cursor.continue();
          };
        };
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

async function getAllFromStore(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  const request = tx.objectStore(storeName).getAll();
  return requestToPromise(request);
}

async function getDefaultProject() {
  const projects = await getAllFromStore(STORE.projects);
  return projects.find(project => project.isDefault) ?? null;
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

async function listProjects() {
  const projects = await getAllFromStore(STORE.projects);
  return projects.sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return a.id - b.id;
  });
}

async function listConversations() {
  const conversations = await getAllFromStore(STORE.conversations);
  return conversations.sort((a, b) => a.id - b.id);
}

async function getProject(projectId) {
  const db = await openDatabase();
  const tx = db.transaction(STORE.projects, 'readonly');
  const request = tx.objectStore(STORE.projects).get(projectId);
  return requestToPromise(request);
}

async function ensureDefaultProject() {
  const existing = await getDefaultProject();
  if (existing) return existing;
  return createProject(DEFAULT_PROJECT_NAME, { isDefault: true });
}

async function createProject(name, { isDefault = false } = {}) {
  const now = new Date().toISOString();
  return withTransaction(STORE.projects, 'readwrite', async tx => {
    const project = {
      name,
      isDefault,
      createdAt: now,
      updatedAt: now,
    };
    const id = await requestToPromise(tx.objectStore(STORE.projects).add(project));
    return { id, ...project };
  });
}

async function renameProject(projectId, name) {
  return withTransaction(STORE.projects, 'readwrite', async tx => {
    const store = tx.objectStore(STORE.projects);
    const project = await requestToPromise(store.get(projectId));
    if (!project || project.isDefault) return null;
    const updated = { ...project, name, updatedAt: new Date().toISOString() };
    await requestToPromise(store.put(updated));
    return updated;
  });
}

async function deleteProject(projectId) {
  const defaultProject = await ensureDefaultProject();
  if (projectId === defaultProject.id) return null;

  const now = new Date().toISOString();
  return withTransaction([STORE.projects, STORE.conversations], 'readwrite', async tx => {
    const projectStore = tx.objectStore(STORE.projects);
    const conversationStore = tx.objectStore(STORE.conversations);
    const project = await requestToPromise(projectStore.get(projectId));
    if (!project || project.isDefault) return null;

    const conversations = await requestToPromise(conversationStore.index('projectId').getAll(projectId));
    for (const conversation of conversations) {
      await requestToPromise(conversationStore.put({
        ...conversation,
        projectId: defaultProject.id,
        updatedAt: now,
      }));
    }

    await requestToPromise(projectStore.delete(projectId));
    return {
      deletedProject: project,
      fallbackProjectId: defaultProject.id,
      movedConversationIds: conversations.map(conversation => conversation.id),
    };
  });
}

async function moveConversationToProject(conversationId, projectId) {
  const now = new Date().toISOString();
  return withTransaction([STORE.projects, STORE.conversations], 'readwrite', async tx => {
    const store = tx.objectStore(STORE.conversations);
    const conversation = await requestToPromise(store.get(conversationId));
    if (!conversation) return null;
    const targetProject = await requestToPromise(tx.objectStore(STORE.projects).get(projectId));
    if (!targetProject) return null;
    if (conversation.projectId === projectId) return conversation;
    const updated = { ...conversation, projectId, updatedAt: now };
    await requestToPromise(store.put(updated));
    return updated;
  });
}

async function createConversation(name, projectId = null) {
  const now = new Date().toISOString();
  const targetProjectId = projectId ?? (await ensureDefaultProject()).id;
  return withTransaction(STORE.conversations, 'readwrite', async tx => {
    const conversation = {
      name,
      projectId: targetProjectId,
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

async function duplicateConversationFromMessages({ name, messages, projectId = null }) {
  const now = new Date().toISOString();
  const targetProjectId = projectId ?? (await ensureDefaultProject()).id;
  return withTransaction([STORE.conversations, STORE.messages, STORE.attachments], 'readwrite', async tx => {
    const conversationStore = tx.objectStore(STORE.conversations);
    const messageStore = tx.objectStore(STORE.messages);
    const attachmentStore = tx.objectStore(STORE.attachments);

    const conversationId = await requestToPromise(conversationStore.add({
      name,
      projectId: targetProjectId,
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

    return { id: conversationId, name, projectId: targetProjectId, createdAt: now, updatedAt: now };
  });
}

async function loadAppState() {
  let projects = await listProjects();
  let defaultProject = projects.find(project => project.isDefault);

  if (!defaultProject) {
    defaultProject = await createProject(DEFAULT_PROJECT_NAME, { isDefault: true });
    projects = await listProjects();
  }

  let conversations = await listConversations();
  const knownProjectIds = new Set(projects.map(project => project.id));
  const conversationsNeedingProject = conversations.filter(conversation => (
    conversation.projectId == null || !knownProjectIds.has(conversation.projectId)
  ));

  if (conversationsNeedingProject.length) {
    for (const conversation of conversationsNeedingProject) {
      await moveConversationToProject(conversation.id, defaultProject.id);
    }
    conversations = await listConversations();
  }

  if (!conversations.length) {
    const created = await createConversation('Conversation 1', defaultProject.id);
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
    projects,
    conversations,
    currentConversationId,
    messages,
    settings,
  };
}

export {
  appendMessage,
  createProject,
  createConversation,
  deleteConversation,
  deleteProject,
  duplicateConversationFromMessages,
  loadAppState,
  loadConversationMessages,
  listProjects,
  moveConversationToProject,
  renameConversation,
  renameProject,
  setSetting,
};
