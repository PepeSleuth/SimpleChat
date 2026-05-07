import { useEffect, useRef, useState } from 'react';
import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import modelsRaw from '../data/models.txt?raw';
import {
  appendMessage,
  createProject,
  createConversation,
  deleteConversation as deleteConversationRecord,
  deleteProject as deleteProjectRecord,
  duplicateConversationFromMessages,
  exportAllData,
  importAllData,
  listConversations,
  listProjects,
  loadAppState,
  loadConversationMessages,
  moveConversationToProject as moveConversationToProjectRecord,
  renameConversation as renameConversationRecord,
  renameProject as renameProjectRecord,
  searchConversations,
  setSetting,
} from './chatDb';
import { downloadJson } from './lib/exportUtils';
import { hydrateMessages, releaseAttachmentUrls, makeDraftAttachment } from './lib/attachments';
import { messagesToModelMessages, createOpenRouterTools } from './lib/messageUtils';
import SetupScreen from './components/SetupScreen';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import ChatInput from './components/ChatInput';
import ModelPicker from './components/ModelPicker';

const MODEL_LIST = modelsRaw.split('\n').map(l => l.trim()).filter(Boolean);
const DEFAULT_MODEL = 'openai/gpt-5.4-nano';

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
  const [searchResults, setSearchResults] = useState(null);
  const chatRef = useRef(null);
  const abortRef = useRef(null);
  const fileInputRef = useRef(null);
  const loadSeqRef = useRef(0);
  const previousMessagesRef = useRef([]);

  const currentConv = conversations.find(c => c.id === currentConversationId);
  const defaultProject = projects.find(project => project.isDefault) ?? projects[0] ?? null;
  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? projects[0] ?? null;
  const filteredConversations = searchResults !== null
    ? searchResults
    : conversations.filter(c => c.projectId === selectedProject?.id);

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

  async function handleSearchSubmit(q) {
    const results = await searchConversations(q);
    setSearchResults(results);
  }

  function handleSearchClear() {
    setSearchResults(null);
  }

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

  async function handleExport() {
    try {
      const data = await exportAllData();
      const date = new Date().toISOString().slice(0, 10);
      downloadJson(data, `simplechat-backup-${date}.json`);
    } catch (err) {
      setError(err.message || 'Export failed');
    }
  }

  async function handleImport(file) {
    let data;
    try {
      const text = await file.text();
      data = JSON.parse(text);
    } catch {
      setError('Invalid JSON file');
      return;
    }
    try {
      await importAllData(data);
      const [nextProjects, nextConversations] = await Promise.all([listProjects(), listConversations()]);
      setProjects(nextProjects);
      setConversations(nextConversations);
    } catch (err) {
      setError(err.message || 'Import failed');
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
    if (isStreaming || isConversationLoading) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function handleFileDrop(e) {
    if (isStreaming || isConversationLoading) return;
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

  async function sendMessage(text) {
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

  function handleSetReasoningEffort(level) {
    setReasoningEffort(level);
    setSetting('reasoningEffort', level);
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
      <SetupScreen
        apiKeyInput={apiKeyInput}
        modelInput={modelInput}
        webSearchEnabled={webSearchEnabled}
        error={error}
        onApiKeyChange={setApiKeyInput}
        onModelChange={setModelInput}
        onToggleWebSearch={toggleWebSearch}
        onSave={saveConfig}
      />
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar
        projects={projects}
        conversations={conversations}
        filteredConversations={filteredConversations}
        selectedProject={selectedProject}
        currentConversationId={currentConversationId}
        model={model}
        webSearchEnabled={webSearchEnabled}
        reasoningEffort={reasoningEffort}
        isStreaming={isStreaming}
        isConversationLoading={isConversationLoading}
        onNewProject={newProject}
        onSelectProject={setSelectedProjectId}
        onNewConversation={newConversation}
        onRenameProject={renameProject}
        onDeleteProject={deleteProject}
        onOpenConversation={openConversation}
        onMoveConversation={moveConversation}
        onRenameConversation={renameConversation}
        onDeleteConversation={deleteConversation}
        onChangeModel={changeModel}
        onToggleWebSearch={toggleWebSearch}
        onSetReasoningEffort={handleSetReasoningEffort}
        onExport={handleExport}
        onImport={handleImport}
        onSearchSubmit={handleSearchSubmit}
        onSearchClear={handleSearchClear}
        isSearching={searchResults !== null}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <ChatArea
          messages={messages}
          isStreaming={isStreaming}
          isConversationLoading={isConversationLoading}
          streamingText={streamingText}
          error={error}
          chatRef={chatRef}
          onBranch={branchConversation}
        />

        <ChatInput
          pendingAttachments={pendingAttachments}
          isStreaming={isStreaming}
          isConversationLoading={isConversationLoading}
          fileInputRef={fileInputRef}
          onAddFiles={addFiles}
          onDragOver={handleFileDragOver}
          onDrop={handleFileDrop}
          onRemoveAttachment={removePendingAttachment}
          onClearAttachments={clearPendingAttachments}
          onSend={sendMessage}
          onStop={stopStreaming}
        />
      </div>

      {showModelPicker && (
        <ModelPicker
          model={model}
          modelList={MODEL_LIST}
          modelPickerInput={modelPickerInput}
          onModelPickerInputChange={setModelPickerInput}
          onSelect={selectModel}
          onClose={() => setShowModelPicker(false)}
        />
      )}
    </div>
  );
}
