import { useEffect, useRef, useState } from 'react';
import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import modelsRaw from '../data/models.txt?raw';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {
  appendMessage,
  createProject,
  createConversation,
  deleteConversation as deleteConversationRecord,
  deleteProject as deleteProjectRecord,
  duplicateConversationFromMessages,
  loadAppState,
  loadConversationMessages,
  moveConversationToProject as moveConversationToProjectRecord,
  renameConversation as renameConversationRecord,
  renameProject as renameProjectRecord,
  setSetting,
} from './chatDb';

const MODEL_LIST = modelsRaw.split('\n').map(l => l.trim()).filter(Boolean);
const DEFAULT_MODEL = 'meta-llama/llama-3.2-1b-instruct';

function isImageMimeType(mimeType = '') {
  return mimeType.startsWith('image/');
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Failed to read attachment'));
    reader.readAsDataURL(blob);
  });
}

function createAttachmentPreview(attachment) {
  return {
    ...attachment,
    previewUrl: attachment.kind === 'image' ? URL.createObjectURL(attachment.blob) : null,
  };
}

function hydrateMessages(rawMessages = []) {
  return rawMessages.map(message => ({
    ...message,
    attachments: (message.attachments ?? []).map(createAttachmentPreview),
  }));
}

function releaseAttachmentUrls(messages = []) {
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}

function formatCost(cost) {
  if (cost == null) return null;
  const value = typeof cost === 'string' ? Number(cost) : cost;
  if (!Number.isFinite(value)) return null;
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(4)}`;
}

function MessageStats({ stats }) {
  if (!stats) return null;
  const d = new Date(stats.date);
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const costStr = formatCost(stats.cost);
  const parts = [
    <span key="model" title={stats.model}>{stats.model}</span>,
    <span key="date">{date}</span>,
    ...(stats.totalTokens != null ? [
      <span key="tokens" title={`${stats.promptTokens} prompt + ${stats.completionTokens} completion`}>
        {stats.totalTokens} tokens
      </span>,
    ] : []),
    ...(stats.webSearchRequests ? [
      <span key="searches" title="OpenRouter web search requests">
        {stats.webSearchRequests} search{stats.webSearchRequests === 1 ? '' : 'es'}
      </span>,
    ] : []),
    ...(costStr ? [<span key="cost">{costStr}</span>] : []),
  ];

  return (
    <div className="message-stats">
      {parts.map((part, i) => (
        <span key={i} className="message-stat-segment">
          {i > 0 && <span className="stats-sep">|</span>}
          {part}
        </span>
      ))}
    </div>
  );
}

function MessageAttachments({ attachments = [], onRemove }) {
  if (!attachments.length) return null;

  return (
    <div className="message-attachments">
      {attachments.map(attachment => (
        <div
          key={attachment.id}
          className={`attachment-chip${attachment.kind === 'image' ? ' image' : ''}`}
          title={attachment.name}
        >
          {attachment.kind === 'image' ? (
            <img src={attachment.previewUrl} alt={attachment.name} className="attachment-thumb" />
          ) : (
            <span className="attachment-icon">📎</span>
          )}
          <span className="attachment-meta">
            <span className="attachment-name">{attachment.name}</span>
            <span className="attachment-size">
              {formatFileSize(attachment.size)}
              {attachment.mimeType ? ` · ${attachment.mimeType}` : ''}
            </span>
          </span>
          {onRemove && (
            <button
              type="button"
              className="attachment-remove-btn"
              onClick={() => onRemove(attachment.id)}
              aria-label={`Remove ${attachment.name}`}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

async function attachmentToPart(attachment) {
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

async function messagesToModelMessages(messages) {
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

function makeDraftAttachment(file) {
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

function hasFileDrag(dataTransfer) {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types ?? []);
  if (types.includes('Files')) return true;
  return Array.from(dataTransfer.items ?? []).some(item => item.kind === 'file');
}

function createOpenRouterTools(openrouter) {
  return {
    web_search: openrouter.tools.webSearch({}),
  };
}

export default function App() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [configured, setConfigured] = useState(false);

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [modelInput, setModelInput] = useState(DEFAULT_MODEL);

  const [conversations, setConversations] = useState([]);
  const [projects, setProjects] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [messages, setMessages] = useState([]);

  const [inputText, setInputText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConversationLoading, setIsConversationLoading] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [error, setError] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelPickerInput, setModelPickerInput] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const chatRef = useRef(null);
  const abortRef = useRef(null);
  const fileInputRef = useRef(null);
  const fileDragDepthRef = useRef(0);
  const loadSeqRef = useRef(0);
  const previousMessagesRef = useRef([]);

  const currentConv = conversations.find(c => c.id === currentConversationId);
  const defaultProject = projects.find(project => project.isDefault) ?? projects[0] ?? null;
  const isInputDisabled = isStreaming || isConversationLoading;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const state = await loadAppState();
        if (cancelled) return;

        const savedModel = state.settings.model || DEFAULT_MODEL;
        setApiKey(state.settings.apiKey || '');
        setApiKeyInput('');
        setModel(savedModel);
        setModelInput(savedModel);
        setConfigured(Boolean(state.settings.apiKey));
        setProjects(state.projects);
        setConversations(state.conversations);
        setCurrentConversationId(state.currentConversationId);
        setMessages(hydrateMessages(state.messages));
        setReasoningEffort(state.settings.reasoningEffort ?? null);
        setWebSearchEnabled(Boolean(state.settings.webSearchEnabled));
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load chats');
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const previousMessages = previousMessagesRef.current;
    const nextUrls = new Set();

    for (const message of messages) {
      for (const attachment of message.attachments ?? []) {
        if (attachment.previewUrl) nextUrls.add(attachment.previewUrl);
      }
    }

    for (const message of previousMessages) {
      for (const attachment of message.attachments ?? []) {
        if (attachment.previewUrl && !nextUrls.has(attachment.previewUrl)) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      }
    }

    previousMessagesRef.current = messages;
  }, [messages]);

  useEffect(() => () => releaseAttachmentUrls(previousMessagesRef.current), []);

  useEffect(() => {
    if (currentConversationId != null) {
      setSetting('currentConversationId', currentConversationId);
    }
  }, [currentConversationId]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, streamingText, isConversationLoading]);

  function saveConfig() {
    const nextApiKey = apiKeyInput.trim();
    const nextModel = modelInput.trim();
    if (!nextApiKey) { alert('Enter an API key'); return; }
    if (!nextModel) { alert('Enter a model name'); return; }

    setApiKey(nextApiKey);
    setModel(nextModel);
    setConfigured(true);
    setSetting('apiKey', nextApiKey);
    setSetting('model', nextModel);
    if (reasoningEffort !== null) setSetting('reasoningEffort', reasoningEffort);
    setSetting('webSearchEnabled', webSearchEnabled);
  }

  function changeModel() {
    setModelPickerInput('');
    setShowModelPicker(true);
  }

  function selectModel(nextModel) {
    const trimmed = nextModel.trim();
    if (!trimmed) return;
    setModel(trimmed);
    setModelInput(trimmed);
    setSetting('model', trimmed);
    setShowModelPicker(false);
  }

  function toggleWebSearch() {
    const nextValue = !webSearchEnabled;
    setWebSearchEnabled(nextValue);
    setSetting('webSearchEnabled', nextValue);
  }

  function getProjectById(projectId) {
    return projects.find(project => project.id === projectId) ?? null;
  }

  function getConversationProject(conv) {
    return getProjectById(conv.projectId) ?? defaultProject;
  }

  function chooseProjectId(message, initialValue = '') {
    if (!projects.length) return null;

    const lines = projects.map((project, index) => {
      const suffix = project.isDefault ? ' (default)' : '';
      return `${index + 1}. ${project.name}${suffix}`;
    }).join('\n');

    const answer = prompt(`${message}\n\n${lines}`, initialValue);
    if (!answer) return null;

    const trimmed = answer.trim();
    const numericChoice = Number(trimmed);
    if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= projects.length) {
      return projects[numericChoice - 1].id;
    }

    const exactMatch = projects.find(project => project.name.toLowerCase() === trimmed.toLowerCase());
    return exactMatch?.id ?? null;
  }

  function updateConversations(nextConversation) {
    setConversations(prev => prev.map(conv => (conv.id === nextConversation.id ? nextConversation : conv)));
  }

  async function openConversation(conversationId) {
    if (conversationId == null || isStreaming || isConversationLoading) return;
    const seq = ++loadSeqRef.current;
    setIsConversationLoading(true);
    setError('');

    try {
      const rawMessages = await loadConversationMessages(conversationId);
      if (seq !== loadSeqRef.current) return;
      setMessages(hydrateMessages(rawMessages));
      setCurrentConversationId(conversationId);
      await setSetting('currentConversationId', conversationId);
    } catch (err) {
      if (seq === loadSeqRef.current) setError(err.message || 'Failed to load conversation');
    } finally {
      if (seq === loadSeqRef.current) setIsConversationLoading(false);
    }
  }

  async function newProject() {
    if (isStreaming || isConversationLoading) return;

    const name = prompt('Enter project name:', `Project ${projects.filter(project => !project.isDefault).length + 1}`);
    if (!name || !name.trim()) return;

    try {
      const project = await createProject(name.trim());
      setProjects(prev => [...prev, project].sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        return a.id - b.id;
      }));
    } catch (err) {
      setError(err.message || 'Failed to create project');
    }
  }

  async function newConversation(projectId = defaultProject?.id) {
    if (isStreaming || isConversationLoading) return;
    if (projectId == null) return;

    try {
      const project = getProjectById(projectId) ?? defaultProject;
      const projectConversationCount = conversations.filter(conv => conv.projectId === (project?.id ?? projectId)).length;
      const conversation = await createConversation(`Conversation ${projectConversationCount + 1}`, project?.id ?? projectId);
      setConversations(prev => [...prev, conversation]);
      await openConversation(conversation.id);
    } catch (err) {
      setError(err.message || 'Failed to create conversation');
    }
  }

  async function renameConversation(conv) {
    const newName = prompt('Enter new conversation name:', conv.name);
    if (!newName || !newName.trim() || newName.trim() === conv.name) return;

    try {
      const updated = await renameConversationRecord(conv.id, newName.trim());
      if (updated) {
        setConversations(prev => prev.map(c => (c.id === conv.id ? updated : c)));
      }
    } catch (err) {
      setError(err.message || 'Failed to rename conversation');
    }
  }

  async function renameProject(project) {
    if (project.isDefault) return;

    const newName = prompt('Enter new project name:', project.name);
    if (!newName || !newName.trim() || newName.trim() === project.name) return;

    try {
      const updated = await renameProjectRecord(project.id, newName.trim());
      if (updated) {
        setProjects(prev => prev.map(item => (item.id === project.id ? updated : item)));
      }
    } catch (err) {
      setError(err.message || 'Failed to rename project');
    }
  }

  async function moveConversation(conv) {
    if (projects.length <= 1) {
      alert('Create another project first');
      return;
    }

    const targetProjectId = chooseProjectId(`Move "${conv.name}" to which project?`, getConversationProject(conv)?.name ?? '');
    if (targetProjectId == null || targetProjectId === conv.projectId) return;

    try {
      const updated = await moveConversationToProjectRecord(conv.id, targetProjectId);
      if (updated) {
        updateConversations(updated);
      }
    } catch (err) {
      setError(err.message || 'Failed to move conversation');
    }
  }

  async function deleteConversation(conv) {
    if (conversations.length <= 1) {
      alert('Cannot delete the last conversation');
      return;
    }

    if (isStreaming) return;

    if (!confirm(`Delete "${conv.name}"?`)) return;

    try {
      await deleteConversationRecord(conv.id);
      const remaining = conversations.filter(c => c.id !== conv.id);
      setConversations(remaining);

      if (currentConversationId === conv.id) {
        const sameProject = remaining.find(c => c.projectId === conv.projectId) ?? remaining[0];
        await openConversation(sameProject.id);
      }
    } catch (err) {
      setError(err.message || 'Failed to delete conversation');
    }
  }

  async function deleteProject(project) {
    if (project.isDefault) return;

    const projectConversationCount = conversations.filter(conv => conv.projectId === project.id).length;
    const suffix = projectConversationCount ? ` and move ${projectConversationCount} conversation${projectConversationCount === 1 ? '' : 's'} to Unsorted` : '';
    if (!confirm(`Delete project "${project.name}"${suffix}?`)) return;

    try {
      const result = await deleteProjectRecord(project.id);
      if (!result) return;

      setProjects(prev => prev.filter(item => item.id !== project.id));
      setConversations(prev => prev.map(conv => (
        conv.projectId === project.id
          ? { ...conv, projectId: result.fallbackProjectId }
          : conv
      )));
    } catch (err) {
      setError(err.message || 'Failed to delete project');
    }
  }

  async function branchConversation(messageIndex) {
    if (!currentConv || isStreaming || isConversationLoading) return;

    const branchMessages = messages.slice(0, messageIndex + 1);
    const branchName = prompt('Enter name for branched conversation:', `${currentConv.name} (Branch)`);
    if (!branchName || !branchName.trim()) return;

    try {
      const branch = await duplicateConversationFromMessages({
        name: branchName.trim(),
        messages: branchMessages,
        projectId: currentConv.projectId,
      });
      setConversations(prev => [...prev, branch]);
      await openConversation(branch.id);
    } catch (err) {
      setError(err.message || 'Failed to branch conversation');
    }
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  function addFiles(fileList) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;

    const attachments = files.map(makeDraftAttachment);
    setPendingAttachments(prev => [...prev, ...attachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function openFilePicker() {
    if (isInputDisabled) return;
    fileInputRef.current?.click();
  }

  function resetFileDragState() {
    fileDragDepthRef.current = 0;
    setIsDraggingFiles(false);
  }

  function handleFileDragEnter(e) {
    if (isInputDisabled || !hasFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    fileDragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }

  function handleFileDragOver(e) {
    if (isInputDisabled || !hasFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setIsDraggingFiles(true);
  }

  function handleFileDragLeave(e) {
    if (isInputDisabled || !hasFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  }

  function handleFileDrop(e) {
    if (isInputDisabled) return;
    e.preventDefault();
    e.stopPropagation();
    resetFileDragState();
    addFiles(e.dataTransfer.files);
  }

  function removePendingAttachment(id) {
    setPendingAttachments(prev => {
      const next = [];
      for (const attachment of prev) {
        if (attachment.id === id) {
          if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
          continue;
        }
        next.push(attachment);
      }
      return next;
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function clearPendingAttachments() {
    setPendingAttachments(prev => {
      releaseAttachmentUrls([{ attachments: prev }]);
      return [];
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function consumePendingAttachments() {
    setPendingAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function sendMessage() {
    const text = inputText.trim();
    if (isStreaming || isConversationLoading) return;
    if (currentConversationId == null) return;
    if (!text && pendingAttachments.length === 0) return;

    const draftAttachments = pendingAttachments;
    const draftMessages = messages;

    setError('');
    setStreamingText('');
    setIsStreaming(true);

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const userRecord = await appendMessage({
        conversationId: currentConversationId,
        role: 'user',
        text,
        attachments: draftAttachments.map(attachment => ({
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size,
          kind: attachment.kind,
          blob: attachment.blob,
        })),
      });

      const userMessage = {
        id: userRecord.id,
        role: 'user',
        text,
        createdAt: userRecord.createdAt,
        attachments: draftAttachments.map(attachment => ({ ...attachment })),
      };

      setMessages(prev => [...prev, userMessage]);

      if (draftMessages.length === 0 && text) {
        try {
          const updatedConversation = await renameConversationRecord(currentConversationId, text);
          if (updatedConversation) {
            setConversations(prev => prev.map(conv => (
              conv.id === currentConversationId ? updatedConversation : conv
            )));
          }
        } catch (renameErr) {
          console.error('Failed to auto-title conversation from first message', renameErr);
        }
      }

      const openrouter = createOpenRouter({ apiKey });
      const modelOptions = {
        usage: { include: true },
        ...(reasoningEffort ? { extraBody: { reasoning: { effort: reasoningEffort } } } : {}),
      };
      const tools = webSearchEnabled ? createOpenRouterTools(openrouter) : undefined;

      const modelMessages = await messagesToModelMessages([...draftMessages, userMessage]);
      const result = streamText({
        model: openrouter(model, modelOptions),
        messages: modelMessages,
        ...(tools ? { tools } : {}),
        abortSignal: controller.signal,
      });

      consumePendingAttachments();
      setInputText('');

      let fullText = '';
      for await (const chunk of result.textStream) {
        fullText += chunk;
        setStreamingText(fullText);
      }

      const usage = await result.usage;
      const providerMeta = (await result.providerMetadata) ?? (await result.experimental_providerMetadata);
      const cost = providerMeta?.openrouter?.usage?.cost ?? null;
      const webSearchRequests = providerMeta?.openrouter?.usage?.server_tool_use?.web_search_requests ?? null;
      const assistantRecord = await appendMessage({
        conversationId: currentConversationId,
        role: 'assistant',
        text: fullText,
        stats: {
          date: new Date().toISOString(),
          model,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          totalTokens: usage?.totalTokens,
          webSearchRequests,
          cost,
        },
      });

      setMessages(prev => [...prev, {
        id: assistantRecord.id,
        role: 'assistant',
        text: fullText,
        stats: assistantRecord.stats,
        createdAt: assistantRecord.createdAt,
        attachments: [],
      }]);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Unknown error');
      }
    } finally {
      abortRef.current = null;
      setStreamingText('');
      setIsStreaming(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') sendMessage();
  }

  if (isBootstrapping) {
    return (
      <div id="loading-page">
        <h1>SimpleChat</h1>
        <p>Loading chats...</p>
      </div>
    );
  }

  if (!configured) {
    return (
      <div id="setup-page">
        <h1>SimpleChat</h1>
        <div id="api-key-section">
          <h3>API key:</h3>
          <p>Get one from <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">OpenRouter</a>.</p>
          <input
            type="password"
            id="api-key"
            placeholder="sk-or-... or whatever"
            value={apiKeyInput}
            onChange={e => setApiKeyInput(e.target.value)}
          />
          <input
            type="text"
            id="model"
            placeholder="Model name"
            value={modelInput}
            onChange={e => setModelInput(e.target.value)}
          />
          <div className="setup-toggle-row">
            <span>Web search</span>
            <button
              type="button"
              className={`toggle-btn${webSearchEnabled ? ' active' : ''}`}
              onClick={toggleWebSearch}
            >
              {webSearchEnabled ? 'on' : 'off'}
            </button>
          </div>
          <button onClick={saveConfig}>Save</button>
        </div>
        {error && <div className="error">Error: {error}</div>}
      </div>
    );
  }

  return (
    <div id="app-layout">
      <aside id="sidebar">
        <div id="sidebar-header">
          <h1>SimpleChat</h1>
          <button id="new-project-btn" onClick={newProject} title="New project">+ Project</button>
        </div>

        <nav id="project-list">
          {projects.map(project => {
            const projectConversations = conversations.filter(conv => conv.projectId === project.id);
            const isActiveProject = currentConv?.projectId === project.id;

            return (
              <section key={project.id} className={`project-group${isActiveProject ? ' active' : ''}`}>
                <div className="project-header">
                  <div className="project-title">
                    <span className="project-name">{project.name}</span>
                    {project.isDefault && <span className="project-default-tag">default</span>}
                    <span className="project-count">{projectConversations.length}</span>
                  </div>
                  <div className="project-actions">
                    <button
                      className="project-action-btn"
                      title="New conversation"
                      onClick={() => newConversation(project.id)}
                    >
                      +
                    </button>
                    {!project.isDefault && (
                      <>
                        <button
                          className="project-action-btn"
                          title="Rename project"
                          onClick={() => renameProject(project)}
                        >
                          ✎
                        </button>
                        <button
                          className="project-action-btn delete"
                          title="Delete project"
                          onClick={() => deleteProject(project)}
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="project-conversation-list">
                  {projectConversations.length === 0 ? (
                    <div className="project-empty">No conversations yet</div>
                  ) : (
                    projectConversations.map(conv => (
                      <div
                        key={conv.id}
                        className={`conv-item project-conv-item${conv.id === currentConversationId ? ' active' : ''}`}
                        onClick={() => openConversation(conv.id)}
                      >
                        <span className="conv-name">{conv.name}</span>
                        <span className="conv-actions">
                          <button
                            className="conv-action-btn"
                            title="Move"
                            onClick={e => { e.stopPropagation(); moveConversation(conv); }}
                          >
                            ↪
                          </button>
                          <button
                            className="conv-action-btn"
                            title="Rename"
                            onClick={e => { e.stopPropagation(); renameConversation(conv); }}
                          >
                            ✎
                          </button>
                          <button
                            className="conv-action-btn delete"
                            title="Delete"
                            disabled={conversations.length <= 1}
                            onClick={e => { e.stopPropagation(); deleteConversation(conv); }}
                          >
                            ✕
                          </button>
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </nav>

        <div id="sidebar-footer">
          <span id="model-label" title={model}>{model}</span>
          <button id="change-model-btn" onClick={changeModel}>Change model</button>
          <div id="web-search-row">
            <span id="web-search-label">Web search</span>
            <button
              type="button"
              id="web-search-toggle"
              className={webSearchEnabled ? 'active' : ''}
              onClick={toggleWebSearch}
            >
              {webSearchEnabled ? 'on' : 'off'}
            </button>
          </div>
          <div id="reasoning-row">
            <span id="reasoning-label">Reasoning</span>
            <div id="reasoning-btns">
              {[null, 'low', 'medium', 'high'].map(level => (
                <button
                  key={level ?? 'off'}
                  className={`reasoning-btn${reasoningEffort === level ? ' active' : ''}`}
                  onClick={() => {
                    setReasoningEffort(level);
                    setSetting('reasoningEffort', level);
                  }}
                >
                  {level ?? 'off'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <div id="main">
        <div id="chat" ref={chatRef}>
          {messages.length === 0 && !isStreaming && !isConversationLoading && (
            <div id="empty-state">Start a conversation</div>
          )}

          {messages.map((msg, i) => (
            <div key={msg.id ?? i} className={`message ${msg.role}`}>
              <div className="message-label">{msg.role === 'user' ? 'You' : 'AI'}</div>
              <div className="message-content">
                {msg.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{msg.text}</ReactMarkdown>
                ) : (
                  <>
                    {msg.text && <div className="message-text">{msg.text}</div>}
                    <MessageAttachments attachments={msg.attachments} />
                  </>
                )}
                {msg.role === 'assistant' && (
                  <>
                    <MessageStats stats={msg.stats} />
                    <button className="branch-btn" onClick={() => branchConversation(i)}>
                      Branch
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}

          {(isStreaming || isConversationLoading) && (
            <div className="message assistant">
              <div className="message-label">AI</div>
              <div className="message-content">
                {isConversationLoading ? 'Loading conversation...' : (
                  <>
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{streamingText}</ReactMarkdown>
                    <span className="streaming"></span>
                  </>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="message error-msg">
              <span className="error">Error: {error}</span>
            </div>
          )}
        </div>

        {pendingAttachments.length > 0 && (
        <div id="attachment-draft">
            <div id="attachment-draft-header">
              <span>Attachments</span>
              <button type="button" id="clear-attachments-btn" onClick={clearPendingAttachments}>
                Clear all
              </button>
            </div>
            <MessageAttachments attachments={pendingAttachments} onRemove={removePendingAttachment} />
          </div>
        )}

        <div id="input-row">
          <input
            ref={fileInputRef}
            id="file-input"
            type="file"
            multiple
            onChange={e => addFiles(e.target.files)}
            disabled={isInputDisabled}
          />
          <div
            id="file-dropzone"
            className={isDraggingFiles ? 'dragging' : ''}
            role="button"
            tabIndex={isInputDisabled ? -1 : 0}
            aria-label="Add files by dragging and dropping or clicking to browse"
            aria-disabled={isInputDisabled}
            onClick={openFilePicker}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openFilePicker();
              }
            }}
            onDragEnter={handleFileDragEnter}
            onDragOver={handleFileDragOver}
            onDragLeave={handleFileDragLeave}
            onDrop={handleFileDrop}
          >
            <span className="file-dropzone-title">Drop files here</span>
            <span className="file-dropzone-hint">or click to browse</span>
          </div>
          <input
            type="text"
            id="input"
            placeholder="Type your message here"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isInputDisabled}
          />
          <button id="send-btn" onClick={isStreaming ? stopStreaming : sendMessage}>
            {isStreaming ? 'Stop' : 'Send'}
          </button>
        </div>
      </div>

      {showModelPicker && (
        <div id="model-picker-overlay" onClick={() => setShowModelPicker(false)}>
          <div id="model-picker" onClick={e => e.stopPropagation()}>
            <h3>Pick a model</h3>
            <div id="model-picker-list">
              {MODEL_LIST.map(m => (
                <div
                  key={m}
                  className={`model-option${m === model ? ' selected' : ''}`}
                  onClick={() => selectModel(m)}
                >
                  {m}
                </div>
              ))}
            </div>
            <div id="model-picker-custom">
              <input
                type="text"
                placeholder="Or type a custom model…"
                value={modelPickerInput}
                onChange={e => setModelPickerInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') selectModel(modelPickerInput); }}
                autoFocus
              />
              <button onClick={() => selectModel(modelPickerInput)}>Use</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
