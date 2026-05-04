import { useState, useRef, useEffect } from 'react';
import { streamText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

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
    const newModel = prompt('Enter new model name:', model);
    if (newModel && newModel.trim()) {
      const m = newModel.trim();
      LS.setRaw('model', m);
      setModel(m);
      setConversations(prev =>
        prev.map(c => c.id === currentConversationId ? { ...c, messages: [] } : c)
      );
    }
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

  function renameConversation() {
    const newName = prompt('Enter new conversation name:', currentConv.name);
    if (newName && newName.trim() && newName.trim() !== currentConv.name) {
      setConversations(prev =>
        prev.map(c => c.id === currentConversationId ? { ...c, name: newName.trim() } : c)
      );
    }
  }

  function deleteConversation() {
    if (conversations.length <= 1) { alert('Cannot delete the last conversation'); return; }
    if (confirm(`Delete "${currentConv.name}"?`)) {
      const remaining = conversations.filter(c => c.id !== currentConversationId);
      setConversations(remaining);
      setCurrentConversationId(remaining[0].id);
    }
  }

  function switchConversation(e) {
    setCurrentConversationId(parseInt(e.target.value));
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
      <>
        <header><h1>SimpleChat</h1></header>
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
      </>
    );
  }

  return (
    <>
      <header><h1>SimpleChat</h1></header>

      <div id="conversation-controls">
        <button onClick={newConversation}>New Conversation</button>
        <select
          id="conversation-list"
          value={currentConversationId}
          onChange={switchConversation}
        >
          {conversations.map(conv => (
            <option key={conv.id} value={conv.id}>{conv.name}</option>
          ))}
        </select>
        <button onClick={renameConversation}>Rename</button>
        <button id="delete-btn" onClick={deleteConversation} disabled={conversations.length <= 1}>
          Delete
        </button>
      </div>

      <p>Model: <strong>{model}</strong> <button onClick={changeModel}>Change</button></p>

      <div id="chat" ref={chatRef}>
        {messages.map((msg, i) => (
          <div key={i} className="message">
            <span className={msg.role}>{msg.role === 'user' ? 'You' : 'AI'}:</span>{' '}
            {msg.content}
            {msg.role === 'assistant' && (
              <button className="branch-btn" onClick={() => branchConversation(i)}>
                Branch
              </button>
            )}
          </div>
        ))}

        {isStreaming && (
          <div className="message">
            <span className="assistant">AI:</span>{' '}
            {streamingText}<span className="streaming"></span>
          </div>
        )}

        {error && (
          <div className="message">
            <span className="error">Error: {error}</span>
          </div>
        )}
      </div>

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
        {isStreaming ? 'Thinking...' : 'Send'}
      </button>
    </>
  );
}
