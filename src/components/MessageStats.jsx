import { formatCost } from '../lib/messageUtils';

export default function MessageStats({ stats }) {
  if (!stats) return null;
  const d = new Date(stats.date);
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const costStr = formatCost(stats.cost);
  const parts = [
    <span key="model" title={stats.model}>{stats.model}</span>,
    <span key="date">{date}</span>,
    ...(stats.totalTokens != null ? [
      <span key="tokens" title={`${stats.promptTokens} prompt + ${stats.completionTokens} completion`}>
        {stats.totalTokens} tokens
      </span>,
    ] : []),
    ...(stats.webSearchRequests ? [
      <span key="searches" title="OpenRouter web search requests">
        {stats.webSearchRequests} search{stats.webSearchRequests === 1 ? '' : 'es'}
      </span>,
    ] : []),
    ...(costStr ? [<span key="cost">{costStr}</span>] : []),
  ];

  return (
    <div className="flex flex-wrap items-center gap-[6px] mt-[10px] pt-[6px] border-t border-[#30363d] text-[11px] text-[#6e7681] font-mono invisible group-hover:visible">
      {parts.map((part, i) => (
        <span key={i} className="whitespace-nowrap overflow-hidden text-ellipsis max-w-[240px]">
          {i > 0 && <span className="text-[#484f58] select-none max-w-none">|</span>}
          {part}
        </span>
      ))}
    </div>
  );
}
