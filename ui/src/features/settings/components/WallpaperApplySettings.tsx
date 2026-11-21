import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToastStore } from '../../../stores/toast';
import { updateSettings, statusQueryKey } from '../../status/api';
import type { Status } from '../../status/schemas';

const wallpaperPathToken = '{wallpaper_path}';

type ArgumentPart = { kind: 'text'; value: string } | { kind: 'wallpaper-path' };

interface WallpaperApplySettingsProps {
  settings: Status['settings'];
}

function parseArguments(args: string[]): ArgumentPart[] {
  return args.map((value) => (
    value === wallpaperPathToken
      ? { kind: 'wallpaper-path' }
      : { kind: 'text', value }
  ));
}

export function WallpaperApplySettings({ settings }: WallpaperApplySettingsProps) {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const [script, setScript] = useState(settings.wallpaper_apply_script);
  const [args, setArgs] = useState(() => parseArguments(settings.wallpaper_apply_args));

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: async () => {
      showToast('Wallpaper script settings saved', { success: true });
      await queryClient.invalidateQueries({ queryKey: statusQueryKey });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), { error: true }),
  });

  const updateTextArgument = (index: number, value: string) => {
    setArgs((current) => current.map((part, partIndex) => (
      index === partIndex && part.kind === 'text' ? { ...part, value } : part
    )));
  };
  const removeArgument = (index: number) => {
    setArgs((current) => current.filter((_, partIndex) => partIndex !== index));
  };
  const save = () => {
    mutation.mutate({
      wallpaper_apply_script: script,
      wallpaper_apply_args: args.map((part) => (
        part.kind === 'wallpaper-path' ? wallpaperPathToken : part.value
      )),
    });
  };

  return (
    <div className="panel wallpaper-apply-settings">
      <h2>Apply wallpaper</h2>
      <div className="field">
        <label htmlFor="wallpaper-apply-script">Bash script location</label>
        <input
          id="wallpaper-apply-script"
          className="input wide"
          type="text"
          maxLength={4096}
          value={script}
          disabled={mutation.isPending}
          placeholder="~/bin/apply-wallpaper.sh"
          onChange={(event) => setScript(event.currentTarget.value)}
        />
      </div>
      <div className="field">
        <div className="lbl">Arguments, in order</div>
        <p className="muted">
          Each argument is passed literally. Wallpaper path is one argument, so spaces in its path are preserved.
        </p>
        <div className="wallpaper-argument-list">
          {args.map((part, index) => (
            <div className="wallpaper-argument" key={index}>
              <span className="m">{index + 1}.</span>
              {part.kind === 'wallpaper-path' ? (
                <span className="tagchip">Wallpaper path</span>
              ) : (
                <input
                  className="input"
                  aria-label={`Argument ${index + 1}`}
                  maxLength={4096}
                  value={part.value}
                  disabled={mutation.isPending}
                  onChange={(event) => updateTextArgument(index, event.currentTarget.value)}
                />
              )}
              <button
                className="btn small"
                type="button"
                aria-label={`Remove argument ${index + 1}`}
                disabled={mutation.isPending}
                onClick={() => removeArgument(index)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="row">
          <button
            className="btn small"
            type="button"
            disabled={mutation.isPending || args.length >= 64}
            onClick={() => setArgs((current) => [...current, { kind: 'text', value: '' }])}
          >
            Add text argument
          </button>
          <button
            className="btn small"
            type="button"
            disabled={mutation.isPending || args.length >= 64}
            onClick={() => setArgs((current) => [...current, { kind: 'wallpaper-path' }])}
          >
            Add wallpaper path
          </button>
        </div>
      </div>
      <div className="field">
        <div className="lbl">Command preview</div>
        <div className="wallpaper-command-preview" role="region" aria-label="Wallpaper command preview">
          <span className="tagchip">Script</span>
          <code className="m">{script || '(not configured)'}</code>
          {args.map((part, index) => (
            part.kind === 'wallpaper-path'
              ? <span className="tagchip" key={index}>Wallpaper path</span>
              : <code className="m" key={index}>{part.value || '(empty argument)'}</code>
          ))}
        </div>
      </div>
      <p className="muted">
        The script runs only when you choose Apply wallpaper on a Library image. No command string is evaluated.
      </p>
      <div className="row">
        <button className="btn primary" type="button" disabled={mutation.isPending} onClick={save}>
          {mutation.isPending ? 'Saving…' : 'Save wallpaper script'}
        </button>
      </div>
    </div>
  );
}
