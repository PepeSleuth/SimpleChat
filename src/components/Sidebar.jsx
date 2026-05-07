const convActionBase = 'm-0 py-[2px] px-[5px] text-xs bg-transparent text-inherit border border-current cursor-pointer opacity-60 rounded-[3px] hover:opacity-100';

export default function Sidebar({
  projects,
  conversations,
  filteredConversations,
  selectedProject,
  currentConversationId,
  model,
  webSearchEnabled,
  reasoningEffort,
  isStreaming,
  isConversationLoading,
  onNewProject,
  onSelectProject,
  onNewConversation,
  onRenameProject,
  onDeleteProject,
  onOpenConversation,
  onMoveConversation,
  onRenameConversation,
  onDeleteConversation,
  onChangeModel,
  onToggleWebSearch,
  onSetReasoningEffort,
}) {
  return (
    <aside className="w-60 shrink-0 flex flex-col bg-[#f5f5f5] border-r border-[#ddd]">
      <div className="flex items-center justify-between pt-4 px-3 pb-3 border-b border-[#ddd] gap-2">
        <h1 className="m-0 text-lg leading-[1.2]">SimpleChat</h1>
        <button
          className="m-0 py-1.5 px-2.5 text-xs leading-none bg-black text-white border-none cursor-pointer shrink-0 rounded-full whitespace-nowrap hover:bg-[#333]"
          onClick={onNewProject}
          title="New project"
        >
          + Project
        </button>
      </div>

      <div className="border-b border-[#ddd]">
        {projects.map(project => {
          const isSelected = project.id === selectedProject?.id;
          return (
            <div
              key={project.id}
              className={`group flex items-center justify-between px-3 py-[7px] cursor-pointer select-none gap-2 ${isSelected ? 'bg-white' : 'hover:bg-[#ebebeb]'}`}
              onClick={() => onSelectProject(project.id)}
            >
              <span className={`text-[13px] overflow-hidden text-ellipsis whitespace-nowrap flex-1 ${isSelected ? 'font-bold text-black' : 'text-[#555]'}`}>
                {project.name}
              </span>
              <div className="flex gap-1 shrink-0">
                <button
                  className="m-0 py-1 px-[7px] text-xs bg-transparent text-[#444] border border-[#d1d1d1] cursor-pointer rounded-full hover:text-black hover:border-[#999] hover:bg-white"
                  title="New conversation"
                  onClick={e => { e.stopPropagation(); onNewConversation(project.id); }}
                >
                  +
                </button>
                {!project.isDefault && (
                  <>
                    <button
                      className="m-0 py-1 px-[7px] text-xs bg-transparent text-[#444] border border-[#d1d1d1] cursor-pointer rounded-full hover:text-black hover:border-[#999] hover:bg-white hidden group-hover:block"
                      title="Rename project"
                      onClick={e => { e.stopPropagation(); onRenameProject(project); }}
                    >
                      ✎
                    </button>
                    <button
                      className="m-0 py-1 px-[7px] text-xs bg-transparent text-[#444] border border-[#d1d1d1] cursor-pointer rounded-full hover:bg-[#c00] hover:text-white hover:border-[#c00] hidden group-hover:block"
                      title="Delete project"
                      onClick={e => { e.stopPropagation(); onDeleteProject(project); }}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <nav className="flex-1 overflow-y-auto py-1">
        {filteredConversations.length === 0 ? (
          <div className="py-[10px] px-3 text-[#999] text-[13px] italic">No conversations yet</div>
        ) : (
          filteredConversations.map(conv => {
            const isActive = conv.id === currentConversationId;
            return (
              <div
                key={conv.id}
                className={`group flex items-center justify-between py-2 px-3 cursor-pointer select-none gap-[6px] ${isActive ? 'bg-black text-white' : 'hover:bg-[#e8e8e8]'}`}
                onClick={() => onOpenConversation(conv.id)}
              >
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm">{conv.name}</span>
                <span className={`gap-[2px] shrink-0 ${isActive ? 'flex' : 'hidden group-hover:flex'}`}>
                  <button
                    className={`${convActionBase} hover:bg-white/15`}
                    title="Move"
                    onClick={e => { e.stopPropagation(); onMoveConversation(conv); }}
                  >
                    ↪
                  </button>
                  <button
                    className={`${convActionBase} hover:bg-white/15`}
                    title="Rename"
                    onClick={e => { e.stopPropagation(); onRenameConversation(conv); }}
                  >
                    ✎
                  </button>
                  <button
                    className={`${convActionBase} hover:bg-[#c00] hover:text-white hover:border-[#c00] disabled:opacity-25 disabled:cursor-not-allowed`}
                    title="Delete"
                    disabled={conversations.length <= 1}
                    onClick={e => { e.stopPropagation(); onDeleteConversation(conv); }}
                  >
                    ✕
                  </button>
                </span>
              </div>
            );
          })
        )}
      </nav>

      <div className="p-3 border-t border-[#ddd] flex flex-col gap-[6px]">
        <span className="text-xs text-[#666] overflow-hidden text-ellipsis whitespace-nowrap" title={model}>{model}</span>
        <button
          className="m-0 py-1.5 px-2.5 text-[13px] bg-black text-white border-none cursor-pointer w-full hover:bg-[#333]"
          onClick={onChangeModel}
        >
          Change model
        </button>
        <div className="flex flex-col gap-1 mt-[2px]">
          <span className="text-[11px] text-[#888] uppercase tracking-[0.05em]">Web search</span>
          <button
            type="button"
            className={`m-0 py-1 px-2.5 text-xs border cursor-pointer capitalize ${webSearchEnabled ? 'bg-black text-white border-black' : 'bg-transparent text-[#555] border-[#ccc] hover:border-[#999] hover:text-black'}`}
            onClick={onToggleWebSearch}
          >
            {webSearchEnabled ? 'on' : 'off'}
          </button>
        </div>
        <div className="flex flex-col gap-1 mt-[2px]">
          <span className="text-[11px] text-[#888] uppercase tracking-[0.05em]">Reasoning</span>
          <div className="flex gap-1">
            {[null, 'low', 'medium', 'high'].map(level => (
              <button
                key={level ?? 'off'}
                className={`flex-1 py-1 px-0 text-xs border cursor-pointer capitalize ${reasoningEffort === level ? 'bg-black text-white border-black' : 'bg-transparent text-[#555] border-[#ccc] hover:border-[#999] hover:text-black'}`}
                onClick={() => onSetReasoningEffort(level)}
              >
                {level ?? 'off'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
