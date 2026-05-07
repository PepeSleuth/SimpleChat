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
    <div className="flex flex-wrap items-center gap-[6px] mt-[10px] pt-[6px] border-t border-[#eee] text-[11px] text-[#bbb] font-mono invisible group-hover:visible">
      {parts.map((part, i) => (
        <span key={i} className="whitespace-nowrap overflow-hidden text-ellipsis max-w-[240px]">
          {i > 0 && <span className="text-[#ddd] select-none max-w-none">|</span>}
          {part}
        </span>
      ))}
    </div>
  );
}

function MessageAttachments({ attachments = [], onRemove }) {
  if (!attachments.length) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-[10px]">
      {attachments.map(attachment => (
        <div
          key={attachment.id}
          className={`inline-flex gap-[10px] max-w-full py-2 px-[10px] border border-[#ddd] bg-[#fafafa] rounded-[10px] ${attachment.kind === 'image' ? 'items-start' : 'items-center'}`}
          title={attachment.name}
        >
          {attachment.kind === 'image' ? (
            <img src={attachment.previewUrl} alt={attachment.name} className="w-11 h-11 object-cover rounded-lg bg-[#eee] shrink-0" />
          ) : (
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-[#efefef] shrink-0 text-lg">📎</span>
          )}
          <span className="min-w-0 flex flex-col gap-[2px]">
            <span className="text-[13px] font-semibold text-[#222] overflow-hidden text-ellipsis whitespace-nowrap">{attachment.name}</span>
            <span className="text-[11px] text-[#777] overflow-hidden text-ellipsis whitespace-nowrap">
              {formatFileSize(attachment.size)}
              {attachment.mimeType ? ` · ${attachment.mimeType}` : ''}
            </span>
          </span>
          {onRemove && (
            <button
              type="button"
              className="ml-auto p-0 border-none bg-transparent text-[#888] cursor-pointer text-lg leading-none shrink-0 hover:text-black"
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
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const chatRef = useRef(null);
  const abortRef = useRef(null);
  const fileInputRef = useRef(null);
  const loadSeqRef = useRef(0);
  const previousMessagesRef = useRef([]);

  const currentConv = conversations.find(c => c.id === currentConversationId);
  const defaultProject = projects.find(project => project.isDefault) ?? projects[0] ?? null;
  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? projects[0] ?? null;
  const filteredConversations = conversations.filter(c => c.projectId === selectedProject?.id);
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
      const conv = conversations.find(c => c.id === conversationId);
      if (conv?.projectId) setSelectedProjectId(conv.projectId);
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

  function handleFileDragOver(e) {
    if (isInputDisabled) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function handleFileDrop(e) {
    if (isInputDisabled) return;
    e.preventDefault();
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
      <div className="max-w-[480px] mx-auto mt-[60px] px-5">
        <h1 className="m-0 mb-2">SimpleChat</h1>
        <p className="m-0 text-[#666]">Loading chats...</p>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="max-w-[480px] mx-auto mt-[60px] px-5">
        <h1>SimpleChat</h1>
        <div className="my-5 p-5 border-2 border-black">
          <h3>API key:</h3>
          <p>Get one from <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">OpenRouter</a>.</p>
          <input
            type="password"
            placeholder="sk-or-... or whatever"
            className="w-full py-[10px] px-[10px] my-[10px] text-base border border-black"
            value={apiKeyInput}
            onChange={e => setApiKeyInput(e.target.value)}
          />
          <input
            type="text"
            placeholder="Model name"
            className="w-full py-[10px] px-[10px] my-[10px] text-base border border-black"
            value={modelInput}
            onChange={e => setModelInput(e.target.value)}
          />
          <div className="flex items-center justify-between gap-3 my-[10px] text-[13px]">
            <span className="text-[#444]">Web search</span>
            <button
              type="button"
              className={`m-0 py-1 px-2.5 text-xs border cursor-pointer capitalize min-w-[72px] ${webSearchEnabled ? 'bg-black text-white border-black' : 'bg-transparent text-[#555] border-[#ccc] hover:border-[#999] hover:text-black'}`}
              onClick={toggleWebSearch}
            >
              {webSearchEnabled ? 'on' : 'off'}
            </button>
          </div>
          <button
            className="mt-[10px] py-[10px] px-5 text-base bg-black text-white border-none cursor-pointer hover:bg-[#333]"
            onClick={saveConfig}
          >
            Save
          </button>
        </div>
        {error && <div className="text-[#c00] font-bold">Error: {error}</div>}
      </div>
    );
  }

  const convActionBase = 'm-0 py-[2px] px-[5px] text-xs bg-transparent text-inherit border border-current cursor-pointer opacity-60 rounded-[3px] hover:opacity-100';

  return (
    <div className="flex h-full">
      <aside className="w-60 shrink-0 flex flex-col bg-[#f5f5f5] border-r border-[#ddd]">
        <div className="flex items-center justify-between pt-4 px-3 pb-3 border-b border-[#ddd] gap-2">
          <h1 className="m-0 text-lg leading-[1.2]">SimpleChat</h1>
          <button
            className="m-0 py-1.5 px-2.5 text-xs leading-none bg-black text-white border-none cursor-pointer shrink-0 rounded-full whitespace-nowrap hover:bg-[#333]"
            onClick={newProject}
            title="New project"
          >
            + Project
          </button>
        </div>

        <div className="border-b border-[#ddd]">
          {projects.map(project => {
            const isSelected = project.id === selectedProject?.id;
            return (
              <div
                key={project.id}
                className={`group flex items-center justify-between px-3 py-[7px] cursor-pointer select-none gap-2 ${isSelected ? 'bg-white' : 'hover:bg-[#ebebeb]'}`}
                onClick={() => setSelectedProjectId(project.id)}
              >
                <span className={`text-[13px] overflow-hidden text-ellipsis whitespace-nowrap flex-1 ${isSelected ? 'font-bold text-black' : 'text-[#555]'}`}>
                  {project.name}
                </span>
                <div className="flex gap-1 shrink-0">
                  <button
                    className="m-0 py-1 px-[7px] text-xs bg-transparent text-[#444] border border-[#d1d1d1] cursor-pointer rounded-full hover:text-black hover:border-[#999] hover:bg-white"
                    title="New conversation"
                    onClick={e => { e.stopPropagation(); newConversation(project.id); }}
                  >
                    +
                  </button>
                  {!project.isDefault && (
                    <>
                      <button
                        className="m-0 py-1 px-[7px] text-xs bg-transparent text-[#444] border border-[#d1d1d1] cursor-pointer rounded-full hover:text-black hover:border-[#999] hover:bg-white hidden group-hover:block"
                        title="Rename project"
                        onClick={e => { e.stopPropagation(); renameProject(project); }}
                      >
                        ✎
                      </button>
                      <button
                        className="m-0 py-1 px-[7px] text-xs bg-transparent text-[#444] border border-[#d1d1d1] cursor-pointer rounded-full hover:bg-[#c00] hover:text-white hover:border-[#c00] hidden group-hover:block"
                        title="Delete project"
                        onClick={e => { e.stopPropagation(); deleteProject(project); }}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <nav className="flex-1 overflow-y-auto py-1">
          {filteredConversations.length === 0 ? (
            <div className="py-[10px] px-3 text-[#999] text-[13px] italic">No conversations yet</div>
          ) : (
            filteredConversations.map(conv => {
              const isActive = conv.id === currentConversationId;
              return (
                <div
                  key={conv.id}
                  className={`group flex items-center justify-between py-2 px-3 cursor-pointer select-none gap-[6px] ${isActive ? 'bg-black text-white' : 'hover:bg-[#e8e8e8]'}`}
                  onClick={() => openConversation(conv.id)}
                >
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm">{conv.name}</span>
                  <span className={`gap-[2px] shrink-0 ${isActive ? 'flex' : 'hidden group-hover:flex'}`}>
                    <button
                      className={`${convActionBase} hover:bg-white/15`}
                      title="Move"
                      onClick={e => { e.stopPropagation(); moveConversation(conv); }}
                    >
                      ↪
                    </button>
                    <button
                      className={`${convActionBase} hover:bg-white/15`}
                      title="Rename"
                      onClick={e => { e.stopPropagation(); renameConversation(conv); }}
                    >
                      ✎
                    </button>
                    <button
                      className={`${convActionBase} hover:bg-[#c00] hover:text-white hover:border-[#c00] disabled:opacity-25 disabled:cursor-not-allowed`}
                      title="Delete"
                      disabled={conversations.length <= 1}
                      onClick={e => { e.stopPropagation(); deleteConversation(conv); }}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              );
            })
          )}
        </nav>

        <div className="p-3 border-t border-[#ddd] flex flex-col gap-[6px]">
          <span className="text-xs text-[#666] overflow-hidden text-ellipsis whitespace-nowrap" title={model}>{model}</span>
          <button
            className="m-0 py-1.5 px-2.5 text-[13px] bg-black text-white border-none cursor-pointer w-full hover:bg-[#333]"
            onClick={changeModel}
          >
            Change model
          </button>
          <div className="flex flex-col gap-1 mt-[2px]">
            <span className="text-[11px] text-[#888] uppercase tracking-[0.05em]">Web search</span>
            <button
              type="button"
              className={`m-0 py-1 px-2.5 text-xs border cursor-pointer capitalize ${webSearchEnabled ? 'bg-black text-white border-black' : 'bg-transparent text-[#555] border-[#ccc] hover:border-[#999] hover:text-black'}`}
              onClick={toggleWebSearch}
            >
              {webSearchEnabled ? 'on' : 'off'}
            </button>
          </div>
          <div className="flex flex-col gap-1 mt-[2px]">
            <span className="text-[11px] text-[#888] uppercase tracking-[0.05em]">Reasoning</span>
            <div className="flex gap-1">
              {[null, 'low', 'medium', 'high'].map(level => (
                <button
                  key={level ?? 'off'}
                  className={`flex-1 py-1 px-0 text-xs border cursor-pointer capitalize ${reasoningEffort === level ? 'bg-black text-white border-black' : 'bg-transparent text-[#555] border-[#ccc] hover:border-[#999] hover:text-black'}`}
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

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-5" ref={chatRef}>
          {messages.length === 0 && !isStreaming && !isConversationLoading && (
            <div className="text-[#aaa] text-center mt-[60px] text-[15px]">Start a conversation</div>
          )}

          {messages.map((msg, i) => (
            <div key={msg.id ?? i} className="group mb-5">
              <div className={`text-xs font-bold uppercase tracking-[0.05em] mb-1 ${msg.role === 'user' ? 'text-black' : 'text-[#999]'}`}>
                {msg.role === 'user' ? 'You' : 'AI'}
              </div>
              <div className="text-base leading-[1.6]">
                {msg.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{msg.text}</ReactMarkdown>
                ) : (
                  <>
                    {msg.text && <div className="whitespace-pre-wrap">{msg.text}</div>}
                    <MessageAttachments attachments={msg.attachments} />
                  </>
                )}
                {msg.role === 'assistant' && (
                  <>
                    <MessageStats stats={msg.stats} />
                    <button
                      className="ml-[10px] py-[2px] px-[6px] text-xs bg-[#999] text-white border-none rounded-[3px] cursor-pointer invisible group-hover:visible align-middle hover:bg-[#777]"
                      onClick={() => branchConversation(i)}
                    >
                      Branch
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}

          {(isStreaming || isConversationLoading) && (
            <div className="group mb-5">
              <div className="text-xs font-bold uppercase tracking-[0.05em] mb-1 text-[#999]">AI</div>
              <div className="text-base leading-[1.6]">
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
            <div className="mb-5">
              <span className="text-[#c00] font-bold">Error: {error}</span>
            </div>
          )}
        </div>

        {pendingAttachments.length > 0 && (
          <div className="border-t border-[#eee] bg-[#fafafa] pt-3 px-5 pb-0">
            <div className="flex items-center justify-between gap-[10px] mb-[10px] text-xs uppercase tracking-[0.05em] text-[#777]">
              <span>Attachments</span>
              <button
                type="button"
                className="m-0 p-0 border-none bg-transparent text-[#555] cursor-pointer text-xs hover:text-black"
                onClick={clearPendingAttachments}
              >
                Clear all
              </button>
            </div>
            <MessageAttachments attachments={pendingAttachments} onRemove={removePendingAttachment} />
          </div>
        )}

        <div className="flex border-t border-[#ddd] py-3 px-5 gap-[10px] bg-white items-center flex-wrap">
          <label
            className={[
              'flex flex-col justify-center gap-[2px] m-0 py-[9px] px-[14px]',
              'min-w-[170px] min-h-[46px] text-[13px] border border-dashed border-[#c8c8c8]',
              'cursor-pointer shrink-0 select-none hover:border-black',
              isInputDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : '',
            ].join(' ')}
            onDragOver={handleFileDragOver}
            onDrop={handleFileDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={e => addFiles(e.target.files)}
              disabled={isInputDisabled}
            />
            <span className="font-bold">Drop files here</span>
            <span className="text-[#666]">or click to browse</span>
          </label>
          <input
            type="text"
            placeholder="Type your message here"
            className="flex-1 min-w-[180px] py-[10px] px-3 text-base border border-[#ccc] outline-none focus:border-black"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isInputDisabled}
          />
          <button
            className="m-0 py-[10px] px-5 text-base bg-black text-white border-none cursor-pointer shrink-0 hover:bg-[#333] disabled:bg-[#999] disabled:cursor-not-allowed"
            onClick={isStreaming ? stopStreaming : sendMessage}
          >
            {isStreaming ? 'Stop' : 'Send'}
          </button>
        </div>
      </div>

      {showModelPicker && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]"
          onClick={() => setShowModelPicker(false)}
        >
          <div
            className="bg-white border-2 border-black p-5 w-[360px] max-h-[80vh] flex flex-col gap-3"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="m-0 text-[15px]">Pick a model</h3>
            <div className="overflow-y-auto border border-[#ddd] flex-1">
              {MODEL_LIST.map(m => (
                <div
                  key={m}
                  className={`py-[10px] px-3 text-sm cursor-pointer border-b border-[#f0f0f0] last:border-b-0 ${m === model ? 'bg-black text-white' : 'hover:bg-[#f5f5f5]'}`}
                  onClick={() => selectModel(m)}
                >
                  {m}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Or type a custom model…"
                className="flex-1 py-2 px-[10px] text-sm border border-[#ccc] outline-none focus:border-black"
                value={modelPickerInput}
                onChange={e => setModelPickerInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') selectModel(modelPickerInput); }}
                autoFocus
              />
              <button
                className="py-2 px-[14px] text-sm bg-black text-white border-none cursor-pointer hover:bg-[#333]"
                onClick={() => selectModel(modelPickerInput)}
              >
                Use
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
