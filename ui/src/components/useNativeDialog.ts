import { useEffect, type RefObject } from 'react';

export function useNativeDialog(ref: RefObject<HTMLDialogElement | null>) {
  // Native dialogs must be opened imperatively and closed when their React owner unmounts.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (!dialog.open) return;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, []);
}
