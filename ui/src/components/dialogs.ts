interface ActiveLayer {
  dialog: HTMLDialogElement;
  onClose?: () => void;
}

let activeLayer: ActiveLayer | null = null;

function show(dialog: HTMLDialogElement) {
  document.body.append(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

export function closeLayer() {
  const layer = activeLayer;
  if (!layer) return;
  activeLayer = null;
  if (typeof layer.dialog.close === 'function' && layer.dialog.open) layer.dialog.close();
  else layer.dialog.removeAttribute('open');
  layer.dialog.remove();
  layer.onClose?.();
}

export function hasLayer() {
  return activeLayer !== null;
}

export function openSheet(title: string, content: Node, footer: Node | Node[] | null, closeIcon: Node, onClose?: () => void) {
  closeLayer();
  const dialog = document.createElement('dialog');
  dialog.className = 'sheet';
  dialog.setAttribute('aria-label', title);

  const header = document.createElement('header');
  const heading = document.createElement('h2');
  heading.textContent = title;
  const close = document.createElement('button');
  close.className = 'btn small icon-btn';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.title = 'Close';
  close.append(closeIcon);
  close.addEventListener('click', closeLayer);
  header.append(heading, close);

  const body = document.createElement('div');
  body.className = 'content';
  body.append(content);
  dialog.append(header, body);
  const footerNodes = footer ? (Array.isArray(footer) ? footer : [footer]) : [];
  if (footerNodes.length) {
    const footerElement = document.createElement('footer');
    footerElement.append(...footerNodes);
    dialog.append(footerElement);
  }

  activeLayer = { dialog, onClose };
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeLayer();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeLayer();
  });
  show(dialog);
  dialog.querySelector<HTMLElement>('input,select,textarea')?.focus();
  return dialog;
}

export function confirmDialog(message: string, okText = 'OK', danger = false) {
  closeLayer();
  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const dialog = document.createElement('dialog');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');

    const text = document.createElement('p');
    text.textContent = message;
    const buttons = document.createElement('div');
    buttons.className = 'btns';
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.className = `btn ${danger ? 'danger' : 'primary'}`;
    confirm.type = 'button';
    confirm.textContent = okText;
    buttons.append(cancel, confirm);
    dialog.append(text, buttons);

    const finish = (answer: boolean) => {
      if (resolved) return;
      resolved = true;
      if (activeLayer?.dialog === dialog) closeLayer();
      resolve(answer);
    };
    activeLayer = { dialog, onClose: () => finish(false) };
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(false);
    });
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    show(dialog);
    confirm.focus();
  });
}
