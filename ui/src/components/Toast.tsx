import { useToastStore } from '../stores/toast';

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function Toast() {
  const toast = useToastStore((state) => state.current);
  const show = useToastStore((state) => state.show);

  const undo = async () => {
    if (!toast?.undo) return;
    try {
      await toast.undo();
      show('Undone');
      window.WS.refresh();
    } catch (error) {
      show(messageOf(error), { error: true });
    }
  };

  return (
    <div id="toast" className={`toast${toast?.error ? ' err' : ''}`} hidden={!toast} role="status" aria-live="polite">
      <span>{toast?.message}</span>
      {toast?.undo ? <button className="btn small" onClick={undo}>Undo</button> : null}
    </div>
  );
}
