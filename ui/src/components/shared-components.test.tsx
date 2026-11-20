import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRecentFoldersStore } from '../stores/recent-folders';
import { useSelectionStore } from '../stores/selection';
import { useToastStore } from '../stores/toast';
import { ChipInput } from './ChipInput';
import { FolderPicker } from './FolderPicker';
import { Icon } from './Icon';
import { ImageGrid } from './ImageGrid';
import { SelectionBar } from './SelectionBar';
import { Toast } from './Toast';
import { closeLayer, confirmDialog, hasLayer, openSheet } from './dialogs';

afterEach(() => {
  closeLayer();
  useRecentFoldersStore.setState({ folders: [] });
  useSelectionStore.getState().clear();
  useToastStore.getState().dismiss();
  window.WS = { refresh: () => {} };
});

describe('shared components', () => {
  it('renders mapped Lucide icons as decorative SVGs', () => {
    const { container } = render(<Icon name="close" />);
    expect(container.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  });

  it('selects a shift range and reveals the grid in bounded chunks', () => {
    const items = Array.from({ length: 242 }, (_, index) => ({
      key: `/wallpapers/${index}.jpg`,
      hash: '',
      name: `${index}.jpg`,
      onOpen: vi.fn(),
    }));
    render(
      <>
        <ImageGrid items={items} />
        <SelectionBar allKeys={items.map((item) => item.key)} actions={[]} />
      </>,
    );

    let cells = screen.getAllByRole('listitem');
    expect(cells).toHaveLength(240);
    fireEvent.click(cells[0]);
    fireEvent.click(cells[2], { shiftKey: true });
    expect(useSelectionStore.getState().keys.size).toBe(3);
    expect(screen.getByText('3 selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more (2 not shown)' }));
    cells = screen.getAllByRole('listitem');
    expect(cells).toHaveLength(242);
    fireEvent.click(screen.getByRole('button', { name: 'Details of 0.jpg' }));
    expect(items[0].onOpen).toHaveBeenCalledOnce();
    expect(useSelectionStore.getState().keys.size).toBe(3);
  }, 15000);

  it('filters folders and returns a chosen suggestion', () => {
    const onChange = vi.fn();
    render(<FolderPicker folders={[{ path: 'Nature' }, { path: 'Nature/Forest' }, { path: 'Portraits' }]} onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Folder' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'forest' } });
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Nature/Forest' }));

    expect(onChange).toHaveBeenLastCalledWith('Nature/Forest');
  });

  it('adds, deduplicates, and removes keyword chips', () => {
    const onChange = vi.fn();
    render(<ChipInput initial={['existing']} placeholder="Keywords" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Keywords' });
    fireEvent.change(input, { target: { value: 'new' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'new' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenLastCalledWith(['existing', 'new']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove existing' }));
    expect(onChange).toHaveBeenLastCalledWith(['new']);
  });

  it('renders undoable toasts and refreshes after a successful undo', async () => {
    const refresh = vi.fn();
    window.WS = { refresh };
    const undo = vi.fn();
    useToastStore.getState().show('Moved image', { undo });
    render(<Toast />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(screen.getByText('Undone')).toBeTruthy());
    expect(undo).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('uses native dialogs for sheets and promise-based confirmation', async () => {
    const content = document.createElement('p');
    content.textContent = 'Sheet body';
    const sheet = openSheet('Details', content, null, document.createElement('span'));
    expect(sheet.tagName).toBe('DIALOG');
    expect(hasLayer()).toBe(true);
    closeLayer();
    expect(hasLayer()).toBe(false);

    const result = confirmDialog('Delete image?', 'Delete', true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await expect(result).resolves.toBe(true);
  });
});
