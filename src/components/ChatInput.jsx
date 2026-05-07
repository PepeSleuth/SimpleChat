import MessageAttachments from './MessageAttachments';

export default function ChatInput({
  inputText,
  pendingAttachments,
  isStreaming,
  isConversationLoading,
  fileInputRef,
  onInputChange,
  onKeyDown,
  onAddFiles,
  onDragOver,
  onDrop,
  onRemoveAttachment,
  onClearAttachments,
  onSend,
  onStop,
}) {
  const isInputDisabled = isStreaming || isConversationLoading;

  return (
    <>
      {pendingAttachments.length > 0 && (
        <div className="border-t border-[#eee] bg-[#fafafa] pt-3 px-5 pb-0">
          <div className="flex items-center justify-between gap-[10px] mb-[10px] text-xs uppercase tracking-[0.05em] text-[#777]">
            <span>Attachments</span>
            <button
              type="button"
              className="m-0 p-0 border-none bg-transparent text-[#555] cursor-pointer text-xs hover:text-black"
              onClick={onClearAttachments}
            >
              Clear all
            </button>
          </div>
          <MessageAttachments attachments={pendingAttachments} onRemove={onRemoveAttachment} />
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
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={e => onAddFiles(e.target.files)}
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
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={isInputDisabled}
        />
        <button
          className="m-0 py-[10px] px-5 text-base bg-black text-white border-none cursor-pointer shrink-0 hover:bg-[#333] disabled:bg-[#999] disabled:cursor-not-allowed"
          onClick={isStreaming ? onStop : onSend}
        >
          {isStreaming ? 'Stop' : 'Send'}
        </button>
      </div>
    </>
  );
}
