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
      <div className="my-5 p-5 border-2 border-black">
        <h3>API key:</h3>
        <p>Get one from <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">OpenRouter</a>.</p>
        <input
          type="password"
          placeholder="sk-or-..."
          className="w-full py-[10px] px-[10px] my-[10px] text-base border border-black"
          value={apiKeyInput}
          onChange={e => onApiKeyChange(e.target.value)}
        />
        <input
          type="text"
          placeholder="Model name"
          className="w-full py-[10px] px-[10px] my-[10px] text-base border border-black"
          value={modelInput}
          onChange={e => onModelChange(e.target.value)}
        />
        <div className="flex items-center justify-between gap-3 my-[10px] text-[13px]">
          <span className="text-[#444]">Web search</span>
          <button
            type="button"
            className={`m-0 py-1 px-2.5 text-xs border cursor-pointer capitalize min-w-[72px] ${webSearchEnabled ? 'bg-black text-white border-black' : 'bg-transparent text-[#555] border-[#ccc] hover:border-[#999] hover:text-black'}`}
            onClick={onToggleWebSearch}
          >
            {webSearchEnabled ? 'on' : 'off'}
          </button>
        </div>
        <button
          className="mt-[10px] py-[10px] px-5 text-base bg-black text-white border-none cursor-pointer hover:bg-[#333]"
          onClick={onSave}
        >
          Save
        </button>
      </div>
      {error && <div className="text-[#c00] font-bold">Error: {error}</div>}
    </div>
  );
}
