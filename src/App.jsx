import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import modelsRaw from '../data/models.txt?raw';
import {
  appendMessage,
  createProject,
  createConversation,
  deleteConversation as deleteConversationRecord,
  deleteMessagesAfter,
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
  updateMessageText,
} from './chatDb';
import { downloadJson } from './lib/exportUtils';
import { hydrateMessages, releaseAttachmentUrls, makeDraftAttachment } from './lib/attachments';
import { streamOpenRouterChat } from './lib/openRouterChat';
import { useAppDialog } from './hooks/useAppDialog';
import SetupScreen from './components/SetupScreen';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import ChatInput from './components/ChatInput';
import ModelPicker from './components/ModelPicker';
import AppDialog from './components/AppDialog';

const MODEL_LIST = modelsRaw.split('\n').map(l => l.trim()).filter(Boolean);
const DEFAULT_MODEL = 'openai/gpt-5.4-nano';

export default function App() {
  const { conversationId: conversationIdParam } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
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
  const [streamingReasoningText, setStreamingReasoningText] = useState('');
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
  const savedConversationIdRef = useRef(null);
  const pendingRouteConversationRef = useRef(null);
  const {
    dialog,
    promptText,
    confirmAction,
    pickProject,
    cancelDialog,
    submitDialog,
  } = useAppDialog();

  const currentConv = conversations.find(c => c.id === currentConversationId);
  const defaultProject = projects.find(project => project.isDefault) ?? projects[0] ?? null;
  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? projects[0] ?? null;
  const filteredConversations = (searchResults !== null
    ? searchResults
    : conversations.filter(c => c.projectId === selectedProject?.id)
  ).slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const routeConversationId = /^\d+$/.test(conversationIdParam ?? '')
    ? Number(conversationIdParam)
    : null;

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
        savedConversationIdRef.current = state.currentConversationId;
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
    if (isBootstrapping || !configured || conversations.length === 0) return;

    const savedConversation = conversations.find(conv => conv.id === savedConversationIdRef.current);
    const fallbackConversation = savedConversation ?? conversations[0];

    if (location.pathname === '/') {
      navigate(`/chats/${fallbackConversation.id}`, { replace: true });
      return;
    }

    const pendingRouteConversation = pendingRouteConversationRef.current?.id === routeConversationId
      ? pendingRouteConversationRef.current
      : null;
    const routeConversation = conversations.find(conv => conv.id === routeConversationId) ?? pendingRouteConversation;
    if (!routeConversation) {
      navigate(`/chats/${fallbackConversation.id}`, { replace: true });
      return;
    }

    if (currentConversationId === routeConversation.id) {
      if (selectedProjectId !== routeConversation.projectId) {
        setSelectedProjectId(routeConversation.projectId);
      }
      return;
    }

    openConversation(routeConversation.id, routeConversation);
  }, [
    isBootstrapping,
    configured,
    conversations,
    location.pathname,
    routeConversationId,
    currentConversationId,
    selectedProjectId,
    isStreaming,
    isConversationLoading,
    navigate,
  ]);

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
    if (!nextApiKey) { setError('Enter an API key'); return; }
    if (!nextModel) { setError('Enter a model name'); return; }

    setError('');
    setApiKey(nextApiKey);
    setModel(nextModel);
    setConfigured(true);
    setSetting('apiKey', nextApiKey);
    setSetting('model', nextModel);
    if (reasoningEffort !== null) setSetting('reasoningEffort', reasoningEffort);
    setSetting('webSearchEnabled', webSearchEnabled);
  }

  async function updateApiKey() {
    const nextApiKey = await promptText({
      title: 'OpenRouter key',
      message: 'Enter a new OpenRouter API key.',
      submitLabel: 'Save',
      inputType: 'password',
      placeholder: 'sk-or-...',
    });
    const trimmed = nextApiKey?.trim();
    if (nextApiKey == null || !trimmed) return;

    setError('');
    setApiKey(trimmed);
    setSetting('apiKey', trimmed);
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

  function updateConversations(nextConversation) {
    setConversations(prev => prev.map(conv => (conv.id === nextConversation.id ? nextConversation : conv)));
  }

  async function openConversation(conversationId, knownConversation = null) {
    if (conversationId == null || isStreaming || isConversationLoading) return;
    const seq = ++loadSeqRef.current;
    setIsConversationLoading(true);
    setError('');

    try {
      const rawMessages = await loadConversationMessages(conversationId);
      if (seq !== loadSeqRef.current) return;
      setMessages(hydrateMessages(rawMessages));
      setCurrentConversationId(conversationId);
      savedConversationIdRef.current = conversationId;
      if (pendingRouteConversationRef.current?.id === conversationId) {
        pendingRouteConversationRef.current = null;
      }
      const conv = knownConversation ?? conversations.find(c => c.id === conversationId);
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

    const name = await promptText({
      title: 'New project',
      initialValue: `Project ${projects.filter(project => !project.isDefault).length + 1}`,
      submitLabel: 'Create',
    });
    if (!name?.trim()) return;

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
      pendingRouteConversationRef.current = conversation;
      setConversations(prev => [...prev, conversation]);
      navigate(`/chats/${conversation.id}`);
    } catch (err) {
      setError(err.message || 'Failed to create conversation');
    }
  }

  async function renameConversation(conv) {
    const newName = await promptText({
      title: 'Rename conversation',
      initialValue: conv.name,
      submitLabel: 'Rename',
    });
    if (!newName?.trim() || newName.trim() === conv.name) return;

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

    const newName = await promptText({
      title: 'Rename project',
      initialValue: project.name,
      submitLabel: 'Rename',
    });
    if (!newName?.trim() || newName.trim() === project.name) return;

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
      setError('Create another project first');
      return;
    }

    const targetProjectId = await pickProject({
      title: 'Move conversation',
      message: `Move "${conv.name}" to which project?`,
      projects,
      currentProjectId: getConversationProject(conv)?.id ?? null,
    });
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
      setError('Cannot delete the last conversation');
      return;
    }

    if (isStreaming) return;

    const shouldDelete = await confirmAction({
      title: 'Delete conversation',
      message: `Delete "${conv.name}"?`,
      submitLabel: 'Delete',
    });
    if (!shouldDelete) return;

    try {
      await deleteConversationRecord(conv.id);
      const remaining = conversations.filter(c => c.id !== conv.id);
      setConversations(remaining);

      if (currentConversationId === conv.id) {
        const sameProject = remaining.find(c => c.projectId === conv.projectId) ?? remaining[0];
        navigate(`/chats/${sameProject.id}`, { replace: true });
      }
    } catch (err) {
      setError(err.message || 'Failed to delete conversation');
    }
  }

  async function deleteProject(project) {
    if (project.isDefault) return;

    const projectConversationCount = conversations.filter(conv => conv.projectId === project.id).length;
    const suffix = projectConversationCount ? ` and move ${projectConversationCount} conversation${projectConversationCount === 1 ? '' : 's'} to Unsorted` : '';
    const shouldDelete = await confirmAction({
      title: 'Delete project',
      message: `Delete project "${project.name}"${suffix}?`,
      submitLabel: 'Delete',
    });
    if (!shouldDelete) return;

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
    const branchName = await promptText({
      title: 'Branch conversation',
      initialValue: `${currentConv.name} (Branch)`,
      submitLabel: 'Branch',
    });
    if (!branchName?.trim()) return;

    try {
      const branch = await duplicateConversationFromMessages({
        name: branchName.trim(),
        messages: branchMessages,
        projectId: currentConv.projectId,
      });
      pendingRouteConversationRef.current = branch;
      setConversations(prev => [...prev, branch]);
      navigate(`/chats/${branch.id}`);
    } catch (err) {
      setError(err.message || 'Failed to branch conversation');
    }
  }

  async function editMessage(messageIndex) {
    if (isStreaming || isConversationLoading) return;
    if (currentConversationId == null) return;
    const message = messages[messageIndex];
    if (!message?.id) return;

    const nextText = await promptText({
      title: `Edit ${message.role === 'assistant' ? 'AI' : 'your'} message`,
      initialValue: message.text ?? '',
      submitLabel: 'Save',
      multiline: true,
    });
    if (nextText == null || nextText === (message.text ?? '')) return;

    try {
      const updatedMessage = await updateMessageText(message.id, nextText);
      if (!updatedMessage) return;
      await deleteMessagesAfter(currentConversationId, message.id);

      const editedMessage = { ...message, text: updatedMessage.text ?? '' };
      const nextMessages = [
        ...messages.slice(0, messageIndex),
        editedMessage,
      ];

      setError('');
      setMessages(nextMessages);
      setConversations(await listConversations());

      if (editedMessage.role === 'user') {
        setStreamingText('');
        setIsStreaming(true);
        try {
          await appendAssistantResponse({
            conversationId: currentConversationId,
            contextMessages: nextMessages,
          });
        } finally {
          abortRef.current = null;
          setStreamingText('');
          setIsStreaming(false);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Failed to edit message');
      }
      abortRef.current = null;
      setStreamingText('');
      setIsStreaming(false);
    }
  }

  async function copyMessage(messageIndex) {
    const message = messages[messageIndex];
    const text = message?.text ?? '';
    if (!text) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }

      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (err) {
      setError(err.message || 'Failed to copy message');
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

  async function appendAssistantResponse({ conversationId, contextMessages }) {
    const controller = new AbortController();
    abortRef.current = controller;

    const assistantResponse = await streamOpenRouterChat({
      apiKey,
      model,
      messages: contextMessages,
      reasoningEffort,
      webSearchEnabled,
      abortSignal: controller.signal,
      onText: setStreamingText,
      onReasoningText: setStreamingReasoningText,
    });
    const assistantRecord = await appendMessage({
      conversationId,
      role: 'assistant',
      text: assistantResponse.text,
      stats: assistantResponse.stats,
    });

    setMessages(prev => [...prev, {
      id: assistantRecord.id,
      role: 'assistant',
      text: assistantResponse.text,
      stats: assistantRecord.stats,
      createdAt: assistantRecord.createdAt,
      attachments: [],
    }]);
  }

  async function sendMessage(text) {
    if (isStreaming || isConversationLoading) return;
    if (currentConversationId == null) return;
    if (!text && pendingAttachments.length === 0) return;

    const draftAttachments = pendingAttachments;
    const draftMessages = messages;

    setError('');
    setStreamingText('');
    setStreamingReasoningText('');
    setIsStreaming(true);

    try {
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

      consumePendingAttachments();
      await appendAssistantResponse({
        conversationId: currentConversationId,
        contextMessages: [...draftMessages, userMessage],
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Unknown error');
      }
    } finally {
      abortRef.current = null;
      setStreamingText('');
      setStreamingReasoningText('');
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
        <p className="m-0 text-[#9da7b3]">Loading chats...</p>
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
    <div className="flex h-full bg-[#0d1117] text-[#e6edf3]">
      <Sidebar
        projects={{ items: projects, selected: selectedProject, isSearching: searchResults !== null }}
        conversations={{ items: conversations, filtered: filteredConversations, currentId: currentConversationId }}
        settings={{ model, webSearchEnabled, reasoningEffort }}
        actions={{
          newProject,
          selectProject: setSelectedProjectId,
          newConversation,
          renameProject,
          deleteProject,
          openConversation,
          canOpenConversation: !isStreaming && !isConversationLoading,
          moveConversation,
          renameConversation,
          deleteConversation,
          updateApiKey,
          changeModel,
          toggleWebSearch,
          setReasoningEffort: handleSetReasoningEffort,
          exportData: handleExport,
          importData: handleImport,
          search: handleSearchSubmit,
          clearSearch: handleSearchClear,
        }}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <ChatArea
          messages={messages}
          isStreaming={isStreaming}
          isConversationLoading={isConversationLoading}
          streamingText={streamingText}
          streamingReasoningText={streamingReasoningText}
          reasoningEffort={reasoningEffort}
          error={error}
          chatRef={chatRef}
          onBranch={branchConversation}
          onEdit={editMessage}
          onCopy={copyMessage}
        />

        <ChatInput
          pendingAttachments={pendingAttachments}
          isStreaming={isStreaming}
          isConversationLoading={isConversationLoading}
          fileInputRef={fileInputRef}
          onAddFiles={addFiles}
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

      <AppDialog dialog={dialog} onCancel={cancelDialog} onSubmit={submitDialog} />
    </div>
  );
}
