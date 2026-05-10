import Dexie from 'dexie';

const DEFAULT_PROJECT_NAME = 'Unsorted';

const db = new Dexie('SimpleChat');

db.version(1).stores({
  settings: 'key',
  conversations: '++id, projectId',
  messages: '++id, conversationId',
  attachments: '++id, conversationId, messageId',
});

db.version(2).stores({
  projects: '++id, isDefault',
}).upgrade(async tx => {
  const now = new Date().toISOString();
  const defaultProjectId = await tx.table('projects').add({
    name: DEFAULT_PROJECT_NAME,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
  await tx.table('conversations')
    .filter(conv => conv.projectId == null)
    .modify({ projectId: defaultProjectId, updatedAt: now });
});

async function getDefaultProject() {
  return (await db.projects.filter(p => p.isDefault).first()) ?? null;
}

async function getSetting(key) {
  return db.settings.get(key);
}

async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

async function listProjects() {
  const projects = await db.projects.toArray();
  return projects.sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return a.id - b.id;
  });
}

async function listConversations() {
  const conversations = await db.conversations.toArray();
  return conversations.sort((a, b) => a.id - b.id);
}

async function searchConversations(query) {
  const lower = query.toLowerCase();
  const byName = await db.conversations
    .filter(c => c.name.toLowerCase().includes(lower))
    .toArray();
  const byNameIds = new Set(byName.map(c => c.id));

  const matchingMsgs = await db.messages
    .filter(m => (m.text ?? '').toLowerCase().includes(lower))
    .toArray();
  const msgConvIds = [...new Set(matchingMsgs.map(m => m.conversationId))]
    .filter(id => !byNameIds.has(id));

  const byMsg = msgConvIds.length
    ? await db.conversations.where('id').anyOf(msgConvIds).toArray()
    : [];

  return [...byName, ...byMsg].sort((a, b) => b.id - a.id);
}

async function ensureDefaultProject() {
  const existing = await getDefaultProject();
  if (existing) return existing;
  return createProject(DEFAULT_PROJECT_NAME, { isDefault: true });
}

async function createProject(name, { isDefault = false } = {}) {
  const now = new Date().toISOString();
  const project = { name, isDefault, createdAt: now, updatedAt: now };
  const id = await db.projects.add(project);
  return { id, ...project };
}

async function renameProject(projectId, name) {
  return db.transaction('rw', db.projects, async () => {
    const project = await db.projects.get(projectId);
    if (!project || project.isDefault) return null;
    const updated = { ...project, name, updatedAt: new Date().toISOString() };
    await db.projects.put(updated);
    return updated;
  });
}

async function deleteProject(projectId) {
  const defaultProject = await ensureDefaultProject();
  if (projectId === defaultProject.id) return null;

  const now = new Date().toISOString();
  return db.transaction('rw', [db.projects, db.conversations], async () => {
    const project = await db.projects.get(projectId);
    if (!project || project.isDefault) return null;

    const conversations = await db.conversations.where('projectId').equals(projectId).toArray();
    await Promise.all(
      conversations.map(conv =>
        db.conversations.put({ ...conv, projectId: defaultProject.id, updatedAt: now })
      )
    );

    await db.projects.delete(projectId);
    return {
      deletedProject: project,
      fallbackProjectId: defaultProject.id,
      movedConversationIds: conversations.map(conv => conv.id),
    };
  });
}

async function moveConversationToProject(conversationId, projectId) {
  const now = new Date().toISOString();
  return db.transaction('rw', [db.projects, db.conversations], async () => {
    const conversation = await db.conversations.get(conversationId);
    if (!conversation) return null;
    const targetProject = await db.projects.get(projectId);
    if (!targetProject) return null;
    if (conversation.projectId === projectId) return conversation;
    const updated = { ...conversation, projectId, updatedAt: now };
    await db.conversations.put(updated);
    return updated;
  });
}

async function createConversation(name, projectId = null) {
  const now = new Date().toISOString();
  const targetProjectId = projectId ?? (await ensureDefaultProject()).id;
  const conversation = { name, projectId: targetProjectId, createdAt: now, updatedAt: now };
  const id = await db.conversations.add(conversation);
  return { id, ...conversation };
}

async function renameConversation(conversationId, name) {
  return db.transaction('rw', db.conversations, async () => {
    const conversation = await db.conversations.get(conversationId);
    if (!conversation) return null;
    const updated = { ...conversation, name, updatedAt: new Date().toISOString() };
    await db.conversations.put(updated);
    return updated;
  });
}

async function deleteConversation(conversationId) {
  await db.transaction('rw', [db.conversations, db.messages, db.attachments], async () => {
    await db.attachments.where('conversationId').equals(conversationId).delete();
    await db.messages.where('conversationId').equals(conversationId).delete();
    await db.conversations.delete(conversationId);
  });
}

async function loadConversationMessages(conversationId) {
  const [messages, attachments] = await Promise.all([
    db.messages.where('conversationId').equals(conversationId).toArray(),
    db.attachments.where('conversationId').equals(conversationId).toArray(),
  ]);

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
        .map(({ id, name, mimeType, size, kind, blob }) => ({ id, name, mimeType, size, kind, blob })),
    }));
}

async function appendMessage({ conversationId, role, text, stats = null, attachments = [] }) {
  const now = new Date().toISOString();
  return db.transaction('rw', [db.conversations, db.messages, db.attachments], async () => {
    const messageId = await db.messages.add({ conversationId, role, text, stats, createdAt: now });

    if (attachments.length) {
      await db.attachments.bulkAdd(
        attachments.map(a => ({
          conversationId,
          messageId,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
          kind: a.kind,
          blob: a.blob,
        }))
      );
    }

    const conversation = await db.conversations.get(conversationId);
    if (conversation) {
      await db.conversations.put({ ...conversation, updatedAt: now });
    }

    return { id: messageId, conversationId, role, text, stats, createdAt: now };
  });
}

async function updateMessageText(messageId, text) {
  const now = new Date().toISOString();
  return db.transaction('rw', [db.conversations, db.messages], async () => {
    const message = await db.messages.get(messageId);
    if (!message) return null;

    const updatedMessage = { ...message, text };
    await db.messages.put(updatedMessage);

    const conversation = await db.conversations.get(message.conversationId);
    if (conversation) {
      await db.conversations.put({ ...conversation, updatedAt: now });
    }

    return updatedMessage;
  });
}

async function deleteMessagesAfter(conversationId, messageId) {
  const now = new Date().toISOString();
  return db.transaction('rw', [db.conversations, db.messages, db.attachments], async () => {
    const messagesToDelete = await db.messages
      .where('conversationId')
      .equals(conversationId)
      .filter(message => message.id > messageId)
      .toArray();
    const messageIds = messagesToDelete.map(message => message.id);

    if (messageIds.length) {
      await db.attachments.where('messageId').anyOf(messageIds).delete();
      await db.messages.bulkDelete(messageIds);
    }

    const conversation = await db.conversations.get(conversationId);
    if (conversation) {
      await db.conversations.put({ ...conversation, updatedAt: now });
    }

    return messageIds;
  });
}

async function duplicateConversationFromMessages({ name, messages, projectId = null }) {
  const now = new Date().toISOString();
  const targetProjectId = projectId ?? (await ensureDefaultProject()).id;

  return db.transaction('rw', [db.conversations, db.messages, db.attachments], async () => {
    const conversationId = await db.conversations.add({
      name,
      projectId: targetProjectId,
      createdAt: now,
      updatedAt: now,
    });

    for (const message of messages) {
      const messageId = await db.messages.add({
        conversationId,
        role: message.role,
        text: message.text ?? '',
        stats: message.stats ?? null,
        createdAt: message.createdAt ?? now,
      });

      const attachmentsToCopy = message.attachments ?? [];
      if (attachmentsToCopy.length) {
        await db.attachments.bulkAdd(
          attachmentsToCopy.map(a => ({
            conversationId,
            messageId,
            name: a.name,
            mimeType: a.mimeType,
            size: a.size,
            kind: a.kind,
            blob: a.blob,
          }))
        );
      }
    }

    return { id: conversationId, name, projectId: targetProjectId, createdAt: now, updatedAt: now };
  });
}

async function loadAppState() {
  let projects = await listProjects();
  let defaultProject = projects.find(p => p.isDefault);

  if (!defaultProject) {
    defaultProject = await createProject(DEFAULT_PROJECT_NAME, { isDefault: true });
    projects = await listProjects();
  }

  let conversations = await listConversations();
  const knownProjectIds = new Set(projects.map(p => p.id));
  const conversationsNeedingProject = conversations.filter(conv =>
    conv.projectId == null || !knownProjectIds.has(conv.projectId)
  );

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

  return { projects, conversations, currentConversationId, messages, settings };
}

async function exportAllData() {
  const projects = await db.projects.toArray();
  const conversations = await db.conversations.toArray();
  const messages = await db.messages.toArray();

  const convsByProject = new Map();
  for (const conv of conversations) {
    const list = convsByProject.get(conv.projectId) ?? [];
    list.push(conv);
    convsByProject.set(conv.projectId, list);
  }

  const msgsByConv = new Map();
  for (const msg of messages) {
    const list = msgsByConv.get(msg.conversationId) ?? [];
    list.push(msg);
    msgsByConv.set(msg.conversationId, list);
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    projects: projects.map(project => ({
      name: project.name,
      isDefault: project.isDefault,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      conversations: (convsByProject.get(project.id) ?? []).map(conv => ({
        name: conv.name,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messages: (msgsByConv.get(conv.id) ?? [])
          .sort((a, b) => a.id - b.id)
          .map(msg => ({
            role: msg.role,
            text: msg.text ?? '',
            stats: msg.stats ?? null,
            createdAt: msg.createdAt,
          })),
      })),
    })),
  };
}

async function importAllData(data) {
  if (data.version !== 1 || !Array.isArray(data.projects)) {
    throw new Error('Invalid backup format');
  }

  const defaultProject = await ensureDefaultProject();
  let projectsCreated = 0;
  let conversationsCreated = 0;
  let messagesCreated = 0;

  await db.transaction('rw', [db.projects, db.conversations, db.messages], async () => {
    for (const projectData of data.projects) {
      const now = new Date().toISOString();
      let projectId;

      if (projectData.isDefault) {
        projectId = defaultProject.id;
      } else {
        projectId = await db.projects.add({
          name: projectData.name,
          isDefault: false,
          createdAt: projectData.createdAt ?? now,
          updatedAt: projectData.updatedAt ?? now,
        });
        projectsCreated++;
      }

      for (const convData of projectData.conversations ?? []) {
        const now = new Date().toISOString();
        const conversationId = await db.conversations.add({
          name: convData.name,
          projectId,
          createdAt: convData.createdAt ?? now,
          updatedAt: convData.updatedAt ?? now,
        });
        conversationsCreated++;

        for (const msgData of convData.messages ?? []) {
          await db.messages.add({
            conversationId,
            role: msgData.role,
            text: msgData.text ?? '',
            stats: msgData.stats ?? null,
            createdAt: msgData.createdAt ?? now,
          });
          messagesCreated++;
        }
      }
    }
  });

  return { projectsCreated, conversationsCreated, messagesCreated };
}

export {
  appendMessage,
  createProject,
  createConversation,
  deleteConversation,
  deleteMessagesAfter,
  deleteProject,
  duplicateConversationFromMessages,
  exportAllData,
  importAllData,
  loadAppState,
  loadConversationMessages,
  listConversations,
  listProjects,
  moveConversationToProject,
  renameConversation,
  renameProject,
  searchConversations,
  setSetting,
  updateMessageText,
};
