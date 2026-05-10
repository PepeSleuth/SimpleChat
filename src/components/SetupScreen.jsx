export default function SetupScreen({
  apiKeyInput,
  modelInput,
  webSearchEnabled,
  error,
  onApiKeyChange,
  onModelChange,
  onToggleWebSearch,
  onSave,
}) {
  return (
    <div className="max-w-[480px] mx-auto mt-[60px] px-5">
      <h1>SimpleChat</h1>
      <div className="my-5 p-5 border-2 border-[#30363d] bg-[#0d1117]">
        <h3>API key:</h3>
        <p>Get one from <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">OpenRouter</a>.</p>
        <input
          type="password"
          placeholder="sk-or-..."
          className="w-full py-[10px] px-[10px] my-[10px] text-base bg-[#010409] text-[#e6edf3] border border-[#30363d] outline-none focus:border-[#8b949e] placeholder-[#6e7681]"
          value={apiKeyInput}
          onChange={e => onApiKeyChange(e.target.value)}
        />
        <input
          type="text"
          placeholder="Model name"
          className="w-full py-[10px] px-[10px] my-[10px] text-base bg-[#010409] text-[#e6edf3] border border-[#30363d] outline-none focus:border-[#8b949e] placeholder-[#6e7681]"
          value={modelInput}
          onChange={e => onModelChange(e.target.value)}
        />
        <button
          className="mt-[10px] py-[10px] px-5 text-base bg-[#f0f6fc] text-[#0d1117] border-none cursor-pointer hover:bg-[#c9d1d9]"
          onClick={onSave}
        >
          Save
        </button>
      </div>
      {error && <div className="text-[#ff7b72] font-bold">Error: {error}</div>}
    </div>
  );
}
