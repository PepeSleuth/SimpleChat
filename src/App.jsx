import { useState, useRef, useEffect } from 'react';
import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import modelsRaw from '../data/models.txt?raw';

const MODEL_LIST = modelsRaw.split('\n').map(l => l.trim()).filter(Boolean);

const LS = {
  get: (k, fallback) => {
    try {
      const v = localStorage.getItem(k);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  getRaw: (k, fallback = '') => localStorage.getItem(k) ?? fallback,
  setRaw: (k, v) => localStorage.setItem(k, v),
};

const defaultConversations = () => [{ id: 0, name: 'Conversation 1', messages: [] }];

export default function App() {
  const [apiKey, setApiKey] = useState(() => LS.getRaw('api-key'));
  const [model, setModel] = useState(() => LS.getRaw('model') || 'meta-llama/llama-3.2-1b-instruct');
  const [configured, setConfigured] = useState(() => !!LS.getRaw('api-key'));

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [modelInput, setModelInput] = useState(() => LS.getRaw('model') || 'meta-llama/llama-3.2-1b-instruct');

  const [conversations, setConversations] = useState(() =>
    LS.get('conversations', null) ?? defaultConversations()
  );
  const [currentConversationId, setCurrentConversationId] = useState(() =>
    LS.get('currentConversationId', 0)
  );
  const [nextConversationId, setNextConversationId] = useState(() =>
    LS.get('nextConversationId', 1)
  );

  const [inputText, setInputText] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelPickerInput, setModelPickerInput] = useState('');

  const chatRef = useRef(null);

  const currentConv = conversations.find(c => c.id === currentConversationId);
  const messages = currentConv?.messages ?? [];

  // Persist conversations + ids
  useEffect(() => {
    LS.set('conversations', conversations);
    LS.set('currentConversationId', currentConversationId);
    LS.set('nextConversationId', nextConversationId);
  }, [conversations, currentConversationId, nextConversationId]);

  // Auto-scroll
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, streamingText]);

  function saveConfig() {
    if (!apiKeyInput.trim()) { alert('Enter an API key'); return; }
    if (!modelInput.trim()) { alert('Enter a model name'); return; }
    LS.setRaw('api-key', apiKeyInput.trim());
    LS.setRaw('model', modelInput.trim());
    setApiKey(apiKeyInput.trim());
    setModel(modelInput.trim());
    setConfigured(true);
  }

  function changeModel() {
    setModelPickerInput('');
    setShowModelPicker(true);
  }

  function selectModel(m) {
    m = m.trim();
    if (!m) return;
    LS.setRaw('model', m);
    setModel(m);
    setShowModelPicker(false);
  }

  function newConversation() {
    const name = prompt('Enter conversation name:', `Conversation ${nextConversationId + 1}`);
    if (name && name.trim()) {
      const newConv = { id: nextConversationId, name: name.trim(), messages: [] };
      setConversations(prev => [...prev, newConv]);
      setCurrentConversationId(nextConversationId);
      setNextConversationId(n => n + 1);
    }
  }

  function renameConversation(conv) {
    const newName = prompt('Enter new conversation name:', conv.name);
    if (newName && newName.trim() && newName.trim() !== conv.name) {
      setConversations(prev =>
        prev.map(c => c.id === conv.id ? { ...c, name: newName.trim() } : c)
      );
    }
  }

  function deleteConversation(conv) {
    if (conversations.length <= 1) { alert('Cannot delete the last conversation'); return; }
    if (confirm(`Delete "${conv.name}"?`)) {
      const remaining = conversations.filter(c => c.id !== conv.id);
      setConversations(remaining);
      if (currentConversationId === conv.id) setCurrentConversationId(remaining[0].id);
    }
  }

  function branchConversation(messageIndex) {
    const branchMessages = messages.slice(0, messageIndex + 1);
    const branchName = prompt('Enter name for branched conversation:', `${currentConv.name} (Branch)`);
    if (branchName && branchName.trim()) {
      const newConv = { id: nextConversationId, name: branchName.trim(), messages: [...branchMessages] };
      setConversations(prev => [...prev, newConv]);
      setCurrentConversationId(nextConversationId);
      setNextConversationId(n => n + 1);
    }
  }

  async function sendMessage() {
    const text = inputText.trim();
    if (!text || isStreaming) return;

    const userMsg = { role: 'user', content: text };
    const updatedMessages = [...messages, userMsg];

    setConversations(prev =>
      prev.map(c => c.id === currentConversationId ? { ...c, messages: updatedMessages } : c)
    );
    setInputText('');
    setIsStreaming(true);
    setStreamingText('');
    setError('');

    try {
      const openrouter = createOpenRouter({ apiKey });
      const result = streamText({
        model: openrouter(model),
        messages: updatedMessages,
      });

      let fullText = '';
      for await (const chunk of result.textStream) {
        fullText += chunk;
        setStreamingText(fullText);
      }

      const assistantMsg = { role: 'assistant', content: fullText };
      setConversations(prev =>
        prev.map(c =>
          c.id === currentConversationId
            ? { ...c, messages: [...updatedMessages, assistantMsg] }
            : c
        )
      );
    } catch (err) {
      setError(err.message || 'Unknown error');
    } finally {
      setStreamingText('');
      setIsStreaming(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') sendMessage();
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
          <button onClick={saveConfig}>Save</button>
        </div>
      </div>
    );
  }

  return (
    <div id="app-layout">
      <aside id="sidebar">
        <div id="sidebar-header">
          <h1>SimpleChat</h1>
          <button id="new-conv-btn" onClick={newConversation} title="New conversation">+</button>
        </div>

        <nav id="conv-list">
          {conversations.map(conv => (
            <div
              key={conv.id}
              className={`conv-item${conv.id === currentConversationId ? ' active' : ''}`}
              onClick={() => setCurrentConversationId(conv.id)}
            >
              <span className="conv-name">{conv.name}</span>
              <span className="conv-actions">
                <button
                  className="conv-action-btn"
                  title="Rename"
                  onClick={e => { e.stopPropagation(); renameConversation(conv); }}
                >✎</button>
                <button
                  className="conv-action-btn delete"
                  title="Delete"
                  disabled={conversations.length <= 1}
                  onClick={e => { e.stopPropagation(); deleteConversation(conv); }}
                >✕</button>
              </span>
            </div>
          ))}
        </nav>

        <div id="sidebar-footer">
          <span id="model-label" title={model}>{model}</span>
          <button id="change-model-btn" onClick={changeModel}>Change model</button>
        </div>
      </aside>

      <div id="main">
        <div id="chat" ref={chatRef}>
          {messages.length === 0 && !isStreaming && (
            <div id="empty-state">Start a conversation</div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.role}`}>
              <div className="message-label">{msg.role === 'user' ? 'You' : 'AI'}</div>
              <div className="message-content">
                {msg.content}
                {msg.role === 'assistant' && (
                  <button className="branch-btn" onClick={() => branchConversation(i)}>
                    Branch
                  </button>
                )}
              </div>
            </div>
          ))}

          {isStreaming && (
            <div className="message assistant">
              <div className="message-label">AI</div>
              <div className="message-content">
                {streamingText}<span className="streaming"></span>
              </div>
            </div>
          )}

          {error && (
            <div className="message error-msg">
              <span className="error">Error: {error}</span>
            </div>
          )}
        </div>

        <div id="input-row">
          <input
            type="text"
            id="input"
            placeholder="Type your message here"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
          <button id="send-btn" onClick={sendMessage} disabled={isStreaming}>
            {isStreaming ? '...' : 'Send'}
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
