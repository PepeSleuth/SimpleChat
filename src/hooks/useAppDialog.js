import { useRef, useState } from 'react';

export function useAppDialog() {
  const [dialog, setDialog] = useState(null);
  const resolveRef = useRef(null);

  function openDialog(nextDialog) {
    return new Promise(resolve => {
      resolveRef.current = resolve;
      setDialog(nextDialog);
    });
  }

  function closeWith(value) {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setDialog(null);
  }

  return {
    dialog,
    promptText(options) {
      return openDialog({ type: 'text', ...options });
    },
    confirmAction(options) {
      return openDialog({ type: 'confirm', ...options });
    },
    pickProject(options) {
      return openDialog({ type: 'project', ...options });
    },
    cancelDialog() {
      closeWith(null);
    },
    submitDialog(value) {
      closeWith(value);
    },
  };
}
