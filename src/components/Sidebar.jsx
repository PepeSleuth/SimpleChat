import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const convActionBase = 'm-0 py-[2px] px-[5px] text-xs bg-transparent text-inherit border border-current cursor-pointer opacity-70 rounded-[3px] hover:opacity-100';
const projectActionClass = 'm-0 py-1 px-[7px] text-xs bg-transparent text-[#c9d1d9] border border-[#30363d] cursor-pointer rounded-full hover:text-white hover:border-[#8b949e] hover:bg-[#21262d]';

function SearchInput({ onSubmit, onClear, onNewConversation, selectedProject }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 min-w-0">
        <input
          type="text"
          placeholder="Search conversations..."
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSubmit(value); }}
          className="w-full py-1.5 pl-3 pr-7 text-[13px] bg-[#0d1117] text-[#e6edf3] border border-[#30363d] rounded-full outline-none focus:border-[#8b949e] placeholder-[#6e7681]"
        />
        {value && (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8b949e] hover:text-[#f0f6fc] text-sm leading-none"
            onClick={() => { setValue(''); onClear(); }}
          >x</button>
        )}
      </div>
      <button
        type="button"
        className="m-0 h-[31px] w-[31px] p-0 text-lg leading-none bg-[#f0f6fc] text-[#0d1117] border-none cursor-pointer shrink-0 rounded-full hover:bg-[#c9d1d9]"
        onClick={() => onNewConversation(selectedProject?.id)}
        title={selectedProject ? `New chat in ${selectedProject.name}` : 'New chat'}
        aria-label={selectedProject ? `New chat in ${selectedProject.name}` : 'New chat'}
      >
        +
      </button>
    </div>
  );
}

function ProjectList({ projects, actions }) {
  if (projects.isSearching) return null;

  return (
    <div className="border-b border-[#30363d]">
      {projects.items.map(project => {
        const isSelected = project.id === projects.selected?.id;
        if (project.isDateFilter) {
          return (
            <details
              key={project.id}
              className={`group px-3 py-[7px] cursor-pointer select-none ${isSelected ? 'bg-[#21262d]' : 'hover:bg-[#161b22]'}`}
              open={isSelected}
              onClick={() => actions.selectProject(project.id)}
            >
              <summary className="flex items-center justify-between gap-2 list-none">
                <span className={`text-[13px] overflow-hidden text-ellipsis whitespace-nowrap flex-1 ${isSelected ? 'font-bold text-[#f0f6fc]' : 'text-[#9da7b3]'}`}>
                  {project.name}
                </span>
                <span className="text-[11px] text-[#8b949e] shrink-0">{project.filterDate}</span>
              </summary>
              <label
                className="mt-2 flex flex-col gap-1 text-[11px] uppercase tracking-[0.05em] text-[#8b949e]"
                onClick={e => e.stopPropagation()}
              >
                Created on
                <span className="flex gap-1">
                  <input
                    type="date"
                    value={projects.dateFilterValue}
                    onChange={e => actions.setDateFilter(e.target.value)}
                    className="min-w-0 flex-1 py-1.5 px-2 text-[13px] normal-case tracking-normal bg-[#0d1117] text-[#e6edf3] border border-[#30363d] outline-none focus:border-[#8b949e]"
                  />
                  <button
                    type="button"
                    className={`${projectActionClass} shrink-0 rounded-[3px]`}
                    title="Use a random chat date"
                    onClick={actions.randomizeDateFilter}
                  >
                    Random
                  </button>
                </span>
              </label>
            </details>
          );
        }

        return (
          <div
            key={project.id}
            className={`group flex items-center justify-between px-3 py-[7px] cursor-pointer select-none gap-2 ${isSelected ? 'bg-[#21262d]' : 'hover:bg-[#161b22]'}`}
            onClick={() => actions.selectProject(project.id)}
          >
            <span className={`text-[13px] overflow-hidden text-ellipsis whitespace-nowrap flex-1 ${isSelected ? 'font-bold text-[#f0f6fc]' : 'text-[#9da7b3]'}`}>
              {project.name}
            </span>
            <div className="flex gap-1 shrink-0">
              {!project.isDefault && (
                <>
                  <button
                    className={`${projectActionClass} hidden group-hover:block`}
                    title="Rename project"
                    onClick={e => { e.stopPropagation(); actions.renameProject(project); }}
                  >
                    Edit
                  </button>
                  <button
                    className={`${projectActionClass} hidden group-hover:block hover:bg-[#da3633] hover:text-white hover:border-[#da3633]`}
                    title="Delete project"
                    onClick={e => { e.stopPropagation(); actions.deleteProject(project); }}
                  >
                    x
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConversationList({ projects, conversations, actions }) {
  const viewportRef = useRef(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  const [focusedId, setFocusedId] = useState(null);
  const rowHeight = projects.isSearching ? 47 : 38;
  const count = conversations.filtered.length;

  useLayoutEffect(() => {
    const element = viewportRef.current;
    const measure = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    viewportRef.current.scrollTop = 0;
    setViewport(previous => ({ ...previous, top: 0 }));
  }, [projects.selected?.id, projects.dateFilterValue, projects.isSearching]);

  // Keep a few extra rows mounted above and below the viewport.
  const top = Math.min(viewport.top, Math.max(0, count * rowHeight - viewport.height));
  const start = Math.max(0, Math.floor(top / rowHeight) - 6);
  const end = Math.min(count, Math.ceil((top + viewport.height) / rowHeight) + 6);
  const indices = new Set(Array.from({ length: end - start }, (_, index) => start + index));
  // Preserve focus when scrolling, plus adjacent rows for uninterrupted Tab navigation.
  const focusedIndex = useMemo(
    () => focusedId == null ? -1 : conversations.filtered.findIndex(conv => conv.id === focusedId),
    [conversations.filtered, focusedId],
  );
  if (focusedIndex >= 0) {
    for (let index = Math.max(0, focusedIndex - 1); index <= Math.min(count - 1, focusedIndex + 1); index++) {
      indices.add(index);
    }
  }

  return (
    <nav
      ref={viewportRef}
      aria-label="Conversations"
      className="flex-1 min-h-0 overflow-y-auto py-1"
      onScroll={event => {
        const element = event.currentTarget;
        setViewport({ top: element.scrollTop, height: element.clientHeight });
      }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null);
      }}
    >
      {conversations.filtered.length === 0 ? (
        <div className="py-[10px] px-3 text-[#6e7681] text-[13px] italic">
          {projects.isSearching ? 'No matches found' : 'No conversations yet'}
        </div>
      ) : (
        <div className="relative" style={{ height: count * rowHeight }}>
          {[...indices].sort((a, b) => a - b).map(index => {
            const conv = conversations.filtered[index];
            const isActive = conv.id === conversations.currentId;
            return (
              <div
                key={conv.id}
                style={{ position: 'absolute', top: index * rowHeight, height: rowHeight, width: '100%' }}
                onFocus={() => setFocusedId(conv.id)}
                className={`group flex items-center justify-between py-2 px-3 select-none gap-[6px] ${isActive ? 'bg-[#f0f6fc] text-[#0d1117]' : 'hover:bg-[#161b22]'}`}
              >
                <Link
                  to={`/chats/${conv.id}`}
                  aria-current={isActive ? 'page' : undefined}
                  className="flex-1 overflow-hidden min-w-0 text-inherit no-underline"
                  onClick={e => {
                    if (actions.canOpenConversation === false) e.preventDefault();
                  }}
                >
                  <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm">{conv.name}</span>
                  {projects.isSearching && (
                    <span className="block text-[10px] overflow-hidden text-ellipsis whitespace-nowrap leading-none mt-[1px] opacity-50">
                      {projects.items.find(p => p.id === conv.projectId)?.name ?? ''}
                    </span>
                  )}
                </Link>
                <span className={`gap-[2px] shrink-0 ${isActive ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'}`}>
                  <button
                    className={`${convActionBase} hover:bg-white/15`}
                    title="Move"
                    onClick={e => { e.stopPropagation(); actions.moveConversation(conv); }}
                  >
                    Move
                  </button>
                  <button
                    className={`${convActionBase} hover:bg-[#da3633] hover:text-white hover:border-[#da3633] disabled:opacity-25 disabled:cursor-not-allowed`}
                    title="Delete"
                    disabled={conversations.items.length <= 1}
                    onClick={e => { e.stopPropagation(); actions.deleteConversation(conv); }}
                  >
                    x
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
}

function SidebarSettings({ settings, actions }) {
  return (
    <div className="p-3 border-t border-[#30363d] flex flex-col gap-[6px]">
      <span className="text-xs text-[#9da7b3] overflow-hidden text-ellipsis whitespace-nowrap" title={settings.model}>{settings.model}</span>
      <button
        className="m-0 py-1.5 px-2.5 text-[13px] bg-[#f0f6fc] text-[#0d1117] border-none cursor-pointer w-full hover:bg-[#c9d1d9]"
        onClick={actions.changeModel}
      >
        Change model
      </button>
      <div className="flex gap-1 mt-[2px]">
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <span className="text-[11px] text-[#8b949e] uppercase tracking-[0.05em]">YouTube</span>
          <button
            type="button"
            className={`m-0 py-1 px-2.5 text-xs border cursor-pointer capitalize ${settings.youtubeEnabled ? 'bg-[#f0f6fc] text-[#0d1117] border-[#f0f6fc]' : 'bg-transparent text-[#9da7b3] border-[#30363d] hover:border-[#8b949e] hover:text-[#f0f6fc]'}`}
            aria-label="Send YouTube links as video"
            aria-pressed={Boolean(settings.youtubeEnabled)}
            title="Send YouTube links in your latest message as video. Requires a video-capable model."
            onClick={actions.toggleYoutube}
          >
            {settings.youtubeEnabled ? 'on' : 'off'}
          </button>
        </div>
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <span className="text-[11px] text-[#8b949e] uppercase tracking-[0.05em]">LaTeX</span>
          <button
            type="button"
            className={`m-0 py-1 px-2.5 text-xs border cursor-pointer capitalize ${(settings.mathEnabled ?? false) ? 'bg-[#f0f6fc] text-[#0d1117] border-[#f0f6fc]' : 'bg-transparent text-[#9da7b3] border-[#30363d] hover:border-[#8b949e] hover:text-[#f0f6fc]'}`}
            aria-label="Render LaTeX"
            aria-pressed={Boolean(settings.mathEnabled)}
            onClick={actions.toggleMath}
          >
            {(settings.mathEnabled ?? false) ? 'on' : 'off'}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1 mt-[2px]">
        <span className="text-[11px] text-[#8b949e] uppercase tracking-[0.05em]">Reasoning</span>
        <div className="flex gap-1">
          {[null, 'low', 'medium', 'high'].map(level => (
            <button
              key={level ?? 'off'}
              className={`flex-1 py-1 px-0 text-xs border cursor-pointer capitalize ${settings.reasoningEffort === level ? 'bg-[#f0f6fc] text-[#0d1117] border-[#f0f6fc]' : 'bg-transparent text-[#9da7b3] border-[#30363d] hover:border-[#8b949e] hover:text-[#f0f6fc]'}`}
              onClick={() => actions.setReasoningEffort(level)}
            >
              {level ?? 'off'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1 mt-[2px] pt-2 border-t border-[#30363d]">
        <span className="text-[11px] text-[#8b949e] uppercase tracking-[0.05em]">Chat management (plain text)</span>
        <div className="flex gap-1">
          <button
            className="flex-1 py-1 px-0 text-xs bg-transparent text-[#9da7b3] border border-[#30363d] cursor-pointer hover:border-[#8b949e] hover:text-[#f0f6fc]"
            onClick={actions.exportData}
          >
            Export
          </button>
          <label className="flex-1 py-1 px-0 text-xs bg-transparent text-[#9da7b3] border border-[#30363d] cursor-pointer hover:border-[#8b949e] hover:text-[#f0f6fc] text-center">
            Import
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={e => { if (e.target.files[0]) { actions.importData(e.target.files[0]); e.target.value = ''; } }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({ projects, conversations, settings, actions }) {
  return (
    <aside className="w-60 shrink-0 flex flex-col bg-[#010409] border-r border-[#30363d]">
      <div className="flex items-center justify-between pt-4 px-3 pb-3 border-b border-[#30363d] gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="m-0 text-lg leading-[1.2] truncate">SimpleChat</h1>
          <button
            type="button"
            className="m-0 w-7 h-7 p-0 text-base leading-none bg-transparent text-[#9da7b3] border border-[#30363d] cursor-pointer shrink-0 rounded-full hover:text-[#f0f6fc] hover:border-[#8b949e] hover:bg-[#161b22]"
            onClick={actions.updateApiKey}
            title="Update OpenRouter key"
            aria-label="Update OpenRouter key"
          >
            ⚙
          </button>
        </div>
        <button
          className="m-0 py-1.5 px-2.5 text-xs leading-none bg-[#f0f6fc] text-[#0d1117] border-none cursor-pointer shrink-0 rounded-full whitespace-nowrap hover:bg-[#c9d1d9]"
          onClick={actions.newProject}
          title="New project"
        >
          + Project
        </button>
      </div>

      <div className="px-2 py-2 border-b border-[#30363d]">
        <SearchInput
          onSubmit={actions.search}
          onClear={actions.clearSearch}
          onNewConversation={actions.newConversation}
          selectedProject={projects.selected}
        />
      </div>

      <ProjectList projects={projects} actions={actions} />
      <ConversationList projects={projects} conversations={conversations} actions={actions} />
      <SidebarSettings settings={settings} actions={actions} />
    </aside>
  );
}
