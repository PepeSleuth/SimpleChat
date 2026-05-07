import { formatFileSize } from '../lib/attachments';

export default function MessageAttachments({ attachments = [], onRemove }) {
  if (!attachments.length) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-[10px]">
      {attachments.map(attachment => (
        <div
          key={attachment.id}
          className={`inline-flex gap-[10px] max-w-full py-2 px-[10px] border border-[#ddd] bg-[#fafafa] rounded-[10px] ${attachment.kind === 'image' ? 'items-start' : 'items-center'}`}
          title={attachment.name}
        >
          {attachment.kind === 'image' ? (
            <img src={attachment.previewUrl} alt={attachment.name} className="w-11 h-11 object-cover rounded-lg bg-[#eee] shrink-0" />
          ) : (
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-[#efefef] shrink-0 text-lg">📎</span>
          )}
          <span className="min-w-0 flex flex-col gap-[2px]">
            <span className="text-[13px] font-semibold text-[#222] overflow-hidden text-ellipsis whitespace-nowrap">{attachment.name}</span>
            <span className="text-[11px] text-[#777] overflow-hidden text-ellipsis whitespace-nowrap">
              {formatFileSize(attachment.size)}
              {attachment.mimeType ? ` · ${attachment.mimeType}` : ''}
            </span>
          </span>
          {onRemove && (
            <button
              type="button"
              className="ml-auto p-0 border-none bg-transparent text-[#888] cursor-pointer text-lg leading-none shrink-0 hover:text-black"
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
