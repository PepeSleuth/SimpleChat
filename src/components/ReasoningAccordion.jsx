function formatToolValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export default function ReasoningAccordion({ stats, reasoningText, reasoningEffort, reasoningTokens, toolCalls }) {
  const text = reasoningText ?? stats?.reasoningText ?? '';
  const effort = reasoningEffort ?? stats?.reasoningEffort ?? null;
  const tokens = reasoningTokens ?? stats?.reasoningTokens ?? null;
  const calls = toolCalls ?? stats?.toolCalls ?? [];

  if (!effort && !text && !calls.length) return null;

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
        ) : !calls.length ? (
          <div className="text-[#8b949e]">Loading...</div>
        ) : null}
        {calls.length > 0 && (
          <div className={text ? 'mt-3 border-t border-[#30363d] pt-2' : ''}>
            <div className="mb-1 text-[#8b949e]">Tool calls</div>
            {calls.map(call => (
              <details key={call.id} className="my-1 rounded border border-[#30363d]">
                <summary className="cursor-pointer break-words px-2 py-1">
                  {call.name}
                  <span className={`ml-2 ${call.status === 'error' ? 'text-[#ff7b72]' : 'text-[#8b949e]'}`}>
                    {call.status === 'complete' ? 'Completed' : call.status === 'error' ? 'Failed' : 'Running…'}
                  </span>
                </summary>
                <div className="border-t border-[#30363d] px-2 py-1">
                  {[
                    ['Input', call.input],
                    ['Result', call.output],
                    ['Error', call.error],
                  ].filter(([, value]) => value !== undefined).map(([label, value]) => (
                    <div key={label} className="my-1">
                      <div className="text-[#8b949e]">{label}</div>
                      <pre className="m-0 max-h-[240px] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-[1.5]">
                        {formatToolValue(value)}
                      </pre>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
        <div className="mt-[6px] flex flex-wrap gap-[6px] text-[11px] text-[#6e7681]">
          {tokens != null && <span>{tokens} tokens</span>}
          {effort && <span>effort: {effort}</span>}
        </div>
      </div>
    </details>
  );
}
