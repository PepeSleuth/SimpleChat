export default function ModelPicker({ model, modelList, modelPickerInput, onModelPickerInputChange, onSelect, onClose }) {
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]"
      onClick={onClose}
    >
      <div
        className="bg-white border-2 border-black p-5 w-[360px] max-h-[80vh] flex flex-col gap-3"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="m-0 text-[15px]">Pick a model</h3>
        <div className="overflow-y-auto border border-[#ddd] flex-1">
          {modelList.map(m => (
            <div
              key={m}
              className={`py-[10px] px-3 text-sm cursor-pointer border-b border-[#f0f0f0] last:border-b-0 ${m === model ? 'bg-black text-white' : 'hover:bg-[#f5f5f5]'}`}
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
            className="flex-1 py-2 px-[10px] text-sm border border-[#ccc] outline-none focus:border-black"
            value={modelPickerInput}
            onChange={e => onModelPickerInputChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSelect(modelPickerInput); }}
            autoFocus
          />
          <button
            className="py-2 px-[14px] text-sm bg-black text-white border-none cursor-pointer hover:bg-[#333]"
            onClick={() => onSelect(modelPickerInput)}
          >
            Use
          </button>
        </div>
      </div>
    </div>
  );
}
