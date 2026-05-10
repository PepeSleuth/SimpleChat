import { formatFileSize } from '../lib/attachments';

export default function MessageAttachments({ attachments = [], onRemove }) {
  if (!attachments.length) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-[10px]">
      {attachments.map(attachment => (
        <div
          key={attachment.id}
          className={`inline-flex gap-[10px] max-w-full py-2 px-[10px] border border-[#30363d] bg-[#161b22] rounded-[10px] ${attachment.kind === 'image' ? 'items-start' : 'items-center'}`}
          title={attachment.name}
        >
          {attachment.kind === 'image' ? (
            <img src={attachment.previewUrl} alt={attachment.name} className="w-11 h-11 object-cover rounded-lg bg-[#21262d] shrink-0" />
          ) : (
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-[#21262d] shrink-0 text-lg">📎</span>
          )}
          <span className="min-w-0 flex flex-col gap-[2px]">
            <span className="text-[13px] font-semibold text-[#f0f6fc] overflow-hidden text-ellipsis whitespace-nowrap">{attachment.name}</span>
            <span className="text-[11px] text-[#8b949e] overflow-hidden text-ellipsis whitespace-nowrap">
              {formatFileSize(attachment.size)}
              {attachment.mimeType ? ` · ${attachment.mimeType}` : ''}
            </span>
          </span>
          {onRemove && (
            <button
              type="button"
              className="ml-auto p-0 border-none bg-transparent text-[#8b949e] cursor-pointer text-lg leading-none shrink-0 hover:text-[#f0f6fc]"
              onClick={() => onRemove(attachment.id)}
              aria-label={`Remove ${attachment.name}`}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
