export default function AppDialog({ dialog, onCancel, onSubmit }) {
  if (!dialog) return null;

  const title = dialog.title ?? '';
  const submitLabel = dialog.submitLabel ?? 'OK';
  const cancelLabel = dialog.cancelLabel ?? 'Cancel';

  function handleTextSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    onSubmit(formData.get('value')?.toString() ?? '');
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100]" onClick={onCancel}>
      <div
        className="bg-[#0d1117] border-2 border-[#30363d] p-5 w-[360px] max-w-[calc(100vw-32px)] flex flex-col gap-3 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {title && <h3 className="m-0 text-[15px]">{title}</h3>}
        {dialog.message && <p className="m-0 text-sm text-[#9da7b3] whitespace-pre-wrap">{dialog.message}</p>}

        {dialog.type === 'text' && (
          <form className="flex flex-col gap-3" onSubmit={handleTextSubmit}>
            {dialog.multiline ? (
              <textarea
                name="value"
                defaultValue={dialog.initialValue ?? ''}
                className="w-full min-h-[180px] py-2 px-[10px] text-sm leading-[1.5] bg-[#010409] text-[#e6edf3] border border-[#30363d] outline-none resize-y focus:border-[#8b949e]"
                autoFocus
              />
            ) : (
              <input
                name="value"
                type="text"
                defaultValue={dialog.initialValue ?? ''}
                className="w-full py-2 px-[10px] text-sm bg-[#010409] text-[#e6edf3] border border-[#30363d] outline-none focus:border-[#8b949e]"
                autoFocus
              />
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="py-2 px-[14px] text-sm bg-transparent text-[#9da7b3] border border-[#30363d] cursor-pointer hover:border-[#8b949e] hover:text-[#f0f6fc]" onClick={onCancel}>
                {cancelLabel}
              </button>
              <button type="submit" className="py-2 px-[14px] text-sm bg-[#f0f6fc] text-[#0d1117] border-none cursor-pointer hover:bg-[#c9d1d9]">
                {submitLabel}
              </button>
            </div>
          </form>
        )}

        {dialog.type === 'confirm' && (
          <div className="flex justify-end gap-2">
            <button className="py-2 px-[14px] text-sm bg-transparent text-[#9da7b3] border border-[#30363d] cursor-pointer hover:border-[#8b949e] hover:text-[#f0f6fc]" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button className="py-2 px-[14px] text-sm bg-[#f0f6fc] text-[#0d1117] border-none cursor-pointer hover:bg-[#c9d1d9]" onClick={() => onSubmit(true)}>
              {submitLabel}
            </button>
          </div>
        )}

        {dialog.type === 'project' && (
          <div className="border border-[#30363d] max-h-[300px] overflow-y-auto">
            {dialog.projects.map(project => (
              <button
                key={project.id}
                type="button"
                className={`block w-full text-left py-[10px] px-3 text-sm border-b border-[#30363d] last:border-b-0 cursor-pointer ${project.id === dialog.currentProjectId ? 'bg-[#f0f6fc] text-[#0d1117]' : 'bg-[#0d1117] hover:bg-[#161b22]'}`}
                onClick={() => onSubmit(project.id)}
              >
                {project.name}{project.isDefault ? ' (default)' : ''}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
