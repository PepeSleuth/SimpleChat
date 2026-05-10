import { useEffect, useRef, useState } from 'react';
import MessageAttachments from './MessageAttachments';

export default function ChatInput({
  pendingAttachments,
  isStreaming,
  isConversationLoading,
  fileInputRef,
  onAddFiles,
  onRemoveAttachment,
  onClearAttachments,
  onSend,
  onStop,
}) {
  const [inputText, setInputText] = useState('');
  const isInputDisabled = isStreaming || isConversationLoading;
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [inputText]);

  function submit() {
    const text = inputText.trim();
    if (!text) return;
    onSend(text);
    setInputText('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handlePaste(e) {
    if (isInputDisabled) return;
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      onAddFiles(files);
    }
  }

  return (
    <>
      {pendingAttachments.length > 0 && (
        <div className="border-t border-[#30363d] bg-[#0d1117] pt-3 px-5 pb-0">
          <div className="flex items-center justify-between gap-[10px] mb-[10px] text-xs uppercase tracking-[0.05em] text-[#8b949e]">
            <span>Attachments</span>
            <button
              type="button"
              className="m-0 p-0 border-none bg-transparent text-[#9da7b3] cursor-pointer text-xs hover:text-[#f0f6fc]"
              onClick={onClearAttachments}
            >
              Clear all
            </button>
          </div>
          <MessageAttachments attachments={pendingAttachments} onRemove={onRemoveAttachment} />
        </div>
      )}

      <div className="flex border-t border-[#30363d] py-3 px-5 gap-[10px] bg-[#0d1117] items-end flex-wrap">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => onAddFiles(e.target.files)}
          disabled={isInputDisabled}
        />
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder="Type your message here"
          className="flex-1 min-w-[180px] py-[10px] px-3 text-base bg-[#010409] text-[#e6edf3] border border-[#30363d] outline-none focus:border-[#8b949e] resize-none overflow-y-auto leading-normal placeholder-[#6e7681]"
          style={{ maxHeight: '200px' }}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={isInputDisabled}
        />
        <button
          className="m-0 py-[10px] px-5 text-base bg-[#f0f6fc] text-[#0d1117] border-none cursor-pointer shrink-0 hover:bg-[#c9d1d9] disabled:bg-[#484f58] disabled:text-[#8b949e] disabled:cursor-not-allowed"
          onClick={isStreaming ? onStop : submit}
        >
          {isStreaming ? 'Stop' : 'Send'}
        </button>
      </div>
    </>
  );
}
