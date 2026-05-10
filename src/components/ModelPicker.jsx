export default function ModelPicker({ model, modelList, modelPickerInput, onModelPickerInputChange, onSelect, onClose }) {
  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100]"
      onClick={onClose}
    >
      <div
        className="bg-[#0d1117] border-2 border-[#30363d] p-5 w-[360px] max-h-[80vh] flex flex-col gap-3 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="m-0 text-[15px]">Pick a model</h3>
        <div className="overflow-y-auto border border-[#30363d] flex-1">
          {modelList.map(m => (
            <div
              key={m}
              className={`py-[10px] px-3 text-sm cursor-pointer border-b border-[#30363d] last:border-b-0 ${m === model ? 'bg-[#f0f6fc] text-[#0d1117]' : 'hover:bg-[#161b22]'}`}
              onClick={() => onSelect(m)}
            >
              {m}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Or type a custom model…"
            className="flex-1 py-2 px-[10px] text-sm bg-[#010409] text-[#e6edf3] border border-[#30363d] outline-none focus:border-[#8b949e] placeholder-[#6e7681]"
            value={modelPickerInput}
            onChange={e => onModelPickerInputChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSelect(modelPickerInput); }}
            autoFocus
          />
          <button
            className="py-2 px-[14px] text-sm bg-[#f0f6fc] text-[#0d1117] border-none cursor-pointer hover:bg-[#c9d1d9]"
            onClick={() => onSelect(modelPickerInput)}
          >
            Use
          </button>
        </div>
      </div>
    </div>
  );
}
