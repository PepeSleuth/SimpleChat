import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import MessageStats from './MessageStats';
import MessageAttachments from './MessageAttachments';
import ReasoningAccordion from './ReasoningAccordion';

export default function ChatArea({
  messages,
  isStreaming,
  isConversationLoading,
  streamingText,
  streamingReasoningText,
  reasoningEffort,
  error,
  chatRef,
  onBranch,
  onEdit,
  onCopy,
}) {
  const actionButtonClass = 'py-[2px] px-[6px] text-xs bg-[#30363d] text-[#e6edf3] border-none rounded-[3px] cursor-pointer hover:bg-[#484f58]';

  return (
    <div className="flex-1 overflow-y-auto p-5" ref={chatRef}>
      {messages.length === 0 && !isStreaming && !isConversationLoading && (
        <div className="text-[#6e7681] text-center mt-[60px] text-[15px]">Start a conversation</div>
      )}

      {messages.map((msg, i) => (
        <div key={msg.id ?? i} className="group mb-5">
          <div className={`text-xs font-bold uppercase tracking-[0.05em] mb-1 ${msg.role === 'user' ? 'text-[#f0f6fc]' : 'text-[#8b949e]'}`}>
            {msg.role === 'user' ? 'You' : 'AI'}
          </div>
          <div className="text-base leading-[1.6]">
            {msg.role === 'assistant' ? (
              <>
                <ReasoningAccordion stats={msg.stats} />
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{msg.text}</ReactMarkdown>
              </>
            ) : (
              <>
                {msg.text && <div className="whitespace-pre-wrap">{msg.text}</div>}
                <MessageAttachments attachments={msg.attachments} />
              </>
            )}
            {msg.role === 'assistant' ? (
              <>
                <MessageStats stats={msg.stats} />
                <div className="mt-1 flex items-center gap-[6px] invisible group-hover:visible">
                  <button
                    className={actionButtonClass}
                    onClick={() => onEdit(i)}
                  >
                    Edit
                  </button>
                  <button
                    className={actionButtonClass}
                    onClick={() => onCopy(i)}
                  >
                    Copy
                  </button>
                  <button
                    className={actionButtonClass}
                    onClick={() => onBranch(i)}
                  >
                    Branch
                  </button>
                </div>
              </>
            ) : (
              <div className="mt-1 flex items-center gap-[6px] invisible group-hover:visible">
                <button
                  className={actionButtonClass}
                  onClick={() => onEdit(i)}
                >
                  Edit
                </button>
                <button
                  className={actionButtonClass}
                  onClick={() => onCopy(i)}
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      {(isStreaming || isConversationLoading) && (
        <div className="group mb-5">
          <div className="text-xs font-bold uppercase tracking-[0.05em] mb-1 text-[#8b949e]">AI</div>
          <div className="text-base leading-[1.6]">
            {isConversationLoading ? 'Loading conversation...' : (
              <>
                <ReasoningAccordion reasoningText={streamingReasoningText} reasoningEffort={reasoningEffort} />
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{streamingText}</ReactMarkdown>
                <span className="streaming"></span>
              </>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-5">
          <span className="text-[#ff7b72] font-bold">Error: {error}</span>
        </div>
      )}
    </div>
  );
}
