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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]" onClick={onCancel}>
      <div
        className="bg-white border-2 border-black p-5 w-[360px] max-w-[calc(100vw-32px)] flex flex-col gap-3"
        onClick={e => e.stopPropagation()}
      >
        {title && <h3 className="m-0 text-[15px]">{title}</h3>}
        {dialog.message && <p className="m-0 text-sm text-[#555] whitespace-pre-wrap">{dialog.message}</p>}

        {dialog.type === 'text' && (
          <form className="flex flex-col gap-3" onSubmit={handleTextSubmit}>
            <input
              name="value"
              type="text"
              defaultValue={dialog.initialValue ?? ''}
              className="w-full py-2 px-[10px] text-sm border border-[#ccc] outline-none focus:border-black"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="py-2 px-[14px] text-sm bg-transparent border border-[#ccc] cursor-pointer hover:border-[#999]" onClick={onCancel}>
                {cancelLabel}
              </button>
              <button type="submit" className="py-2 px-[14px] text-sm bg-black text-white border-none cursor-pointer hover:bg-[#333]">
                {submitLabel}
              </button>
            </div>
          </form>
        )}

        {dialog.type === 'confirm' && (
          <div className="flex justify-end gap-2">
            <button className="py-2 px-[14px] text-sm bg-transparent border border-[#ccc] cursor-pointer hover:border-[#999]" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button className="py-2 px-[14px] text-sm bg-black text-white border-none cursor-pointer hover:bg-[#333]" onClick={() => onSubmit(true)}>
              {submitLabel}
            </button>
          </div>
        )}

        {dialog.type === 'project' && (
          <div className="border border-[#ddd] max-h-[300px] overflow-y-auto">
            {dialog.projects.map(project => (
              <button
                key={project.id}
                type="button"
                className={`block w-full text-left py-[10px] px-3 text-sm border-b border-[#f0f0f0] last:border-b-0 cursor-pointer ${project.id === dialog.currentProjectId ? 'bg-black text-white' : 'bg-white hover:bg-[#f5f5f5]'}`}
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
