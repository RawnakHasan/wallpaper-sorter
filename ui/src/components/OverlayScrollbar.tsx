import { useEffect } from 'react';

interface OverlayItem {
  element: HTMLElement;
  track: HTMLDivElement;
  thumbHeight: number;
}

export function OverlayScrollbar() {
  useEffect(() => {
    const finePointer = window.matchMedia('(pointer:fine)').matches;
    const firefox = /firefox/i.test(navigator.userAgent)
      || (window.CSS && CSS.supports('-moz-appearance', 'none'));
    if (!finePointer || !firefox) return;

    const selectors = ['#main', '.sheet', '.tree', '.grid-scroll'];
    const items: OverlayItem[] = [];

    const collect = () => {
      for (const item of items) item.track.remove();
      items.length = 0;

      for (const element of Array.from(document.querySelectorAll<HTMLElement>(selectors.join(',')))) {
        element.classList.add('ws-overlay-scrollbar');
        const track = document.createElement('div');
        track.className = 'ws-overlay-track';
        track.setAttribute('aria-hidden', 'true');
        document.body.append(track);

        const item: OverlayItem = { element, track, thumbHeight: 44 };
        track.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          track.setPointerCapture(event.pointerId);
          track.classList.add('dragging');
          const startY = event.clientY;
          const startTop = element.scrollTop;
          const rect = element.getBoundingClientRect();
          const maxScroll = Math.max(1, element.scrollHeight - element.clientHeight);
          const trackTravel = Math.max(1, rect.height - item.thumbHeight);
          const move = (moveEvent: PointerEvent) => {
            element.scrollTop = startTop + ((moveEvent.clientY - startY) * maxScroll / trackTravel);
          };
          const end = () => {
            track.classList.remove('dragging');
            track.removeEventListener('pointermove', move);
            track.removeEventListener('pointerup', end);
            track.removeEventListener('pointercancel', end);
          };
          track.addEventListener('pointermove', move);
          track.addEventListener('pointerup', end);
          track.addEventListener('pointercancel', end);
        });
        items.push(item);
      }
    };

    const tick = () => {
      for (const item of items) {
        const rect = item.element.getBoundingClientRect();
        const maxScroll = item.element.scrollHeight - item.element.clientHeight;
        const visible = rect.width > 0
          && rect.height > 0
          && maxScroll > 1
          && getComputedStyle(item.element).visibility === 'visible';
        if (!visible) {
          item.track.style.display = 'none';
          continue;
        }
        const thumbHeight = Math.min(rect.height, Math.max(44, rect.height * rect.height / item.element.scrollHeight));
        item.thumbHeight = thumbHeight;
        const top = rect.top + (rect.height - thumbHeight) * (item.element.scrollTop / maxScroll);
        item.track.style.display = 'block';
        item.track.style.left = `${rect.right - 14}px`;
        item.track.style.top = `${top}px`;
        item.track.style.height = `${thumbHeight}px`;
      }
    };

    const frame = () => {
      tick();
      animationFrame = window.requestAnimationFrame(frame);
    };

    collect();
    let animationFrame = window.requestAnimationFrame(frame);
    const observer = new MutationObserver(collect);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      for (const item of items) item.track.remove();
    };
  }, []);

  return null;
}
