import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToastStore } from '../../../stores/toast';
import { updateSettings, statusQueryKey } from '../../status/api';
import type { Status } from '../../status/schemas';
import { getSecretsStatus, saveSecrets, secretsQueryKey } from '../../fetch/api';
import type { SecretsUpdate } from '../../fetch/schemas';

interface FetchSettingsProps {
  settings: Status['settings'];
}

export function FetchSettings({ settings }: FetchSettingsProps) {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const secretsQuery = useQuery({
    queryKey: secretsQueryKey,
    queryFn: getSecretsStatus,
  });
  const [wallhavenKey, setWallhavenKey] = useState('');
  const [danbooruUsername, setDanbooruUsername] = useState('');
  const [danbooruKey, setDanbooruKey] = useState('');
  const [danbooruUserId, setDanbooruUserId] = useState('');
  const ratingsMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: async () => {
      showToast('Saved', { success: true });
      await queryClient.invalidateQueries({ queryKey: statusQueryKey });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), { error: true }),
  });
  const secretsMutation = useMutation({
    mutationFn: saveSecrets,
    onSuccess: async () => {
      setWallhavenKey('');
      setDanbooruUsername('');
      setDanbooruKey('');
      setDanbooruUserId('');
      showToast('API credentials saved', { success: true });
      await queryClient.invalidateQueries({ queryKey: secretsQueryKey });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), { error: true }),
  });

  const save = () => {
    const body: SecretsUpdate = {};
    if (wallhavenKey.trim()) body.wallhaven_api_key = wallhavenKey.trim();
    if (danbooruUsername.trim()) body.danbooru_username = danbooruUsername.trim();
    if (danbooruKey.trim()) body.danbooru_api_key = danbooruKey.trim();
    if (danbooruUserId.trim()) body.danbooru_user_id = danbooruUserId.trim();
    if (Object.keys(body).length) secretsMutation.mutate(body);
  };

  return (
    <div className="panel">
      <h2>Fetch safeguards and API credentials</h2>
      <div className="field">
        <label htmlFor="danbooru-rating">Maximum Danbooru rating</label>
        <select
          id="danbooru-rating"
          className="select"
          aria-label="Maximum Danbooru rating"
          value={settings.danbooru_rating}
          disabled={ratingsMutation.isPending}
          onChange={(event) => ratingsMutation.mutate({ danbooru_rating: event.currentTarget.value as Status['settings']['danbooru_rating'] })}
        >
          <option value="g">General only (safest)</option>
          <option value="s">Sensitive</option>
          <option value="q">Questionable</option>
          <option value="e">Explicit</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="wallhaven-purity">Maximum Wallhaven purity</label>
        <select
          id="wallhaven-purity"
          className="select"
          aria-label="Maximum Wallhaven purity"
          value={settings.wallhaven_purity}
          disabled={ratingsMutation.isPending}
          onChange={(event) => ratingsMutation.mutate({ wallhaven_purity: event.currentTarget.value as Status['settings']['wallhaven_purity'] })}
        >
          <option value="sfw">SFW only (safest)</option>
          <option value="sketchy">Include sketchy</option>
          <option value="nsfw">Include NSFW</option>
        </select>
      </div>
      {secretsQuery.error ? (
        <p className="error" role="alert">
          {secretsQuery.error instanceof Error ? secretsQuery.error.message : String(secretsQuery.error)}
        </p>
      ) : null}
      <p className="muted">
        API keys are stored in secrets.toml with owner-only permissions and are never returned to the page.
        Leave a key blank to keep the saved value.
      </p>
      <div className="field">
        <label htmlFor="wallhaven-api-key">Wallhaven API key</label>
        <input
          id="wallhaven-api-key"
          className="input wide"
          type="password"
          autoComplete="new-password"
          value={wallhavenKey}
          placeholder={secretsQuery.data?.wallhaven_saved ? 'Saved; leave empty to keep' : 'Optional'}
          onChange={(event) => setWallhavenKey(event.currentTarget.value)}
        />
        {secretsQuery.data?.wallhaven_saved ? (
          <button
            className="btn small"
            type="button"
            disabled={secretsMutation.isPending}
            onClick={() => secretsMutation.mutate({ clear_wallhaven: true })}
          >
            Remove Wallhaven key
          </button>
        ) : null}
      </div>
      <div className="field">
        <label htmlFor="danbooru-username">Danbooru username</label>
        <input
          id="danbooru-username"
          className="input wide"
          autoComplete="off"
          value={danbooruUsername}
          placeholder={secretsQuery.data?.danbooru_saved ? 'Saved; leave empty to keep' : 'Optional'}
          onChange={(event) => setDanbooruUsername(event.currentTarget.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="danbooru-api-key">Danbooru API key</label>
        <input
          id="danbooru-api-key"
          className="input wide"
          type="password"
          autoComplete="new-password"
          value={danbooruKey}
          placeholder={secretsQuery.data?.danbooru_saved ? 'Saved; leave empty to keep' : 'Optional'}
          onChange={(event) => setDanbooruKey(event.currentTarget.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="danbooru-user-id">Danbooru numeric user ID (for the request User-Agent)</label>
        <input
          id="danbooru-user-id"
          className="input wide"
          inputMode="numeric"
          value={danbooruUserId}
          onChange={(event) => setDanbooruUserId(event.currentTarget.value)}
        />
      </div>
      <div className="row">
        <button
          className="btn primary"
          type="button"
          disabled={secretsMutation.isPending || !(
            wallhavenKey.trim()
            || danbooruUsername.trim()
            || danbooruKey.trim()
            || danbooruUserId.trim()
          )}
          onClick={save}
        >
          Save API credentials
        </button>
        {secretsQuery.data?.danbooru_saved ? (
          <button
            className="btn small"
            type="button"
            disabled={secretsMutation.isPending}
            onClick={() => secretsMutation.mutate({ clear_danbooru: true })}
          >
            Remove Danbooru credentials
          </button>
        ) : null}
      </div>
    </div>
  );
}
