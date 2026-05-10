export default function ReasoningAccordion({ stats, reasoningText, reasoningEffort, reasoningTokens }) {
  const text = reasoningText ?? stats?.reasoningText ?? '';
  const effort = reasoningEffort ?? stats?.reasoningEffort ?? null;
  const tokens = reasoningTokens ?? stats?.reasoningTokens ?? null;

  if (!effort) return null;

  return (
    <details className="mb-3 max-w-[720px] rounded-[4px] border border-[#30363d] bg-[#161b22] text-[12px] open:border-[#484f58]">
      <summary className="cursor-pointer select-none px-2 py-[6px] font-mono text-[#8b949e] hover:text-[#c9d1d9]">
        Reasoning
      </summary>
      <div className="border-t border-[#30363d] px-2 py-[7px] font-mono text-[#c9d1d9]">
        {text ? (
          <pre className="m-0 max-h-[320px] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-[1.5]">
            {text}
          </pre>
        ) : (
          <div className="text-[#8b949e]">Loading...</div>
        )}
        <div className="mt-[6px] flex flex-wrap gap-[6px] text-[11px] text-[#6e7681]">
          {tokens != null && <span>{tokens} tokens</span>}
          {effort && <span>effort: {effort}</span>}
        </div>
      </div>
    </details>
  );
}
