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
  const [zerochanUsername, setZerochanUsername] = useState('');
  const [editingZerochan, setEditingZerochan] = useState(false);
  const [editingWallhavenKey, setEditingWallhavenKey] = useState(false);
  const [editingDanbooru, setEditingDanbooru] = useState(false);
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
      setEditingWallhavenKey(false);
      setEditingDanbooru(false);
      showToast('API credentials saved', { success: true });
      await queryClient.invalidateQueries({ queryKey: secretsQueryKey });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : String(error), { error: true }),
  });
  const zerochanMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: async () => {
      setZerochanUsername('');
      setEditingZerochan(false);
      showToast('Zerochan username saved', { success: true });
      await queryClient.invalidateQueries({ queryKey: statusQueryKey });
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
      <div className="field">
        <label htmlFor="yandere-rating">Maximum yande.re rating</label>
        <select
          id="yandere-rating"
          className="select"
          aria-label="Maximum yande.re rating"
          value={settings.yandere_rating}
          disabled={ratingsMutation.isPending}
          onChange={(event) => ratingsMutation.mutate({ yandere_rating: event.currentTarget.value as Status['settings']['yandere_rating'] })}
        >
          <option value="s">Safe only (safest)</option>
          <option value="q">Include questionable</option>
          <option value="e">Include explicit</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="safebooru-rating">Maximum Safebooru rating</label>
        <select
          id="safebooru-rating"
          className="select"
          aria-label="Maximum Safebooru rating"
          value={settings.safebooru_rating}
          disabled={ratingsMutation.isPending}
          onChange={(event) => ratingsMutation.mutate({ safebooru_rating: event.currentTarget.value as Status['settings']['safebooru_rating'] })}
        >
          <option value="general">General only (safest)</option>
          <option value="safe">Include safe</option>
          <option value="questionable">Include questionable</option>
          <option value="explicit">Include explicit</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="konachan-rating">Maximum Konachan.net rating</label>
        <select
          id="konachan-rating"
          className="select"
          aria-label="Maximum Konachan.net rating"
          value={settings.konachan_rating}
          disabled={ratingsMutation.isPending}
          onChange={(event) => ratingsMutation.mutate({ konachan_rating: event.currentTarget.value as Status['settings']['konachan_rating'] })}
        >
          <option value="s">Safe only (safest)</option>
          <option value="q">Include questionable</option>
          <option value="e">Include explicit</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="zerochan-username">Zerochan username</label>
        {settings.zerochan_username_saved && !editingZerochan ? (
          <div className="row">
            <span className="m">{settings.zerochan_username}</span>
            <button
              className="btn small"
              type="button"
              aria-label="Edit Zerochan username"
              disabled={zerochanMutation.isPending}
              onClick={() => {
                setZerochanUsername(settings.zerochan_username);
                setEditingZerochan(true);
              }}
            >
              Edit
            </button>
            <button
              className="btn small"
              type="button"
              disabled={zerochanMutation.isPending}
              onClick={() => zerochanMutation.mutate({ zerochan_username: '' })}
            >
              Remove
            </button>
          </div>
        ) : (
          <>
            <input
              id="zerochan-username"
              className="input wide"
              autoComplete="off"
              maxLength={80}
              value={zerochanUsername}
              placeholder="Enter Zerochan username"
              onChange={(event) => setZerochanUsername(event.currentTarget.value)}
            />
            <div className="row">
              <button
                className="btn small"
                type="button"
                disabled={zerochanMutation.isPending || !zerochanUsername.trim()}
                onClick={() => zerochanMutation.mutate({ zerochan_username: zerochanUsername.trim() })}
              >
                Save Zerochan username
              </button>
              {settings.zerochan_username_saved ? (
                <button
                  className="btn small"
                  type="button"
                  disabled={zerochanMutation.isPending}
                  onClick={() => {
                    setZerochanUsername('');
                    setEditingZerochan(false);
                  }}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </>
        )}
        <p className="muted">
          Zerochan requires this name in the request User-Agent and limits API use to 60 requests per minute.
        </p>
      </div>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={settings.warn_before_unrated_sites}
            disabled={ratingsMutation.isPending}
            onChange={(event) => ratingsMutation.mutate({
              warn_before_unrated_sites: event.currentTarget.checked,
            })}
          />
          {' '}Warn before using unrated sites
        </label>
        <p className="muted">
          Zerochan has no content rating, so its downloads are never filtered by rating.
        </p>
      </div>
      {secretsQuery.error ? (
        <p className="error" role="alert">
          {secretsQuery.error instanceof Error ? secretsQuery.error.message : String(secretsQuery.error)}
        </p>
      ) : null}
      <p className="muted">
        API keys are stored in secrets.toml with owner-only permissions and are never returned to the page.
        Leave a key blank to keep the saved value. Danbooru requires your numeric user ID in the request User-Agent;
        username and API key are only needed for authenticated requests.
      </p>
      <div className="field">
        {secretsQuery.data?.wallhaven_saved && !editingWallhavenKey ? (
          <div className="row">
            <span className="lbl">Wallhaven API key</span>
            <span className="muted">Saved (write-only)</span>
            <button className="btn small" type="button" aria-label="Edit Wallhaven API key" onClick={() => setEditingWallhavenKey(true)}>
              Edit
            </button>
          </div>
        ) : (
          <>
            <label htmlFor="wallhaven-api-key">Wallhaven API key</label>
            <input
              id="wallhaven-api-key"
              className="input wide"
              type="password"
              autoComplete="new-password"
              value={wallhavenKey}
              placeholder={secretsQuery.data?.wallhaven_saved ? 'Enter a replacement key' : 'Optional'}
              onChange={(event) => setWallhavenKey(event.currentTarget.value)}
            />
            {secretsQuery.data?.wallhaven_saved ? (
              <button className="btn small" type="button" aria-label="Cancel Wallhaven API key edit" onClick={() => {
                setWallhavenKey('');
                setEditingWallhavenKey(false);
              }}>
                Cancel
              </button>
            ) : null}
          </>
        )}
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
        {(
          secretsQuery.data?.danbooru_username
          || secretsQuery.data?.danbooru_user_id
          || secretsQuery.data?.danbooru_saved
        ) && !editingDanbooru ? (
          <>
            <label>Danbooru credentials</label>
            <div className="row">
              <span className="muted">
                Username: {secretsQuery.data?.danbooru_username || 'Not set'} · User ID: {secretsQuery.data?.danbooru_user_id || 'Not set'} · API key: {secretsQuery.data?.danbooru_saved ? 'Saved (write-only)' : 'Not set'}
              </span>
              <button className="btn small" type="button" aria-label="Edit Danbooru credentials" onClick={() => {
                setDanbooruUsername(secretsQuery.data?.danbooru_username ?? '');
                setDanbooruUserId(secretsQuery.data?.danbooru_user_id ?? '');
                setEditingDanbooru(true);
              }}>
                Edit
              </button>
              <button
                className="btn small"
                type="button"
                disabled={secretsMutation.isPending}
                onClick={() => secretsMutation.mutate({ clear_danbooru: true })}
              >
                Remove
              </button>
            </div>
          </>
        ) : (
          <>
            <label htmlFor="danbooru-username">Danbooru username</label>
            <input
              id="danbooru-username"
              className="input wide"
              autoComplete="off"
              value={danbooruUsername}
              placeholder={secretsQuery.data?.danbooru_username ? 'Enter a replacement username' : 'Optional'}
              onChange={(event) => setDanbooruUsername(event.currentTarget.value)}
            />
            <label htmlFor="danbooru-api-key">Danbooru API key</label>
            <input
              id="danbooru-api-key"
              className="input wide"
              type="password"
              autoComplete="new-password"
              value={danbooruKey}
              placeholder={secretsQuery.data?.danbooru_saved ? 'Enter a replacement key' : 'Optional'}
              onChange={(event) => setDanbooruKey(event.currentTarget.value)}
            />
            <label htmlFor="danbooru-user-id">Danbooru numeric user ID (required for Danbooru API requests)</label>
            <input
              id="danbooru-user-id"
              className="input wide"
              inputMode="numeric"
              value={danbooruUserId}
              placeholder={secretsQuery.data?.danbooru_user_id ? 'Enter a replacement ID' : 'Required for API requests'}
              onChange={(event) => setDanbooruUserId(event.currentTarget.value)}
            />
            {editingDanbooru ? (
              <button className="btn small" type="button" onClick={() => {
                setDanbooruUsername('');
                setDanbooruKey('');
                setDanbooruUserId('');
                setEditingDanbooru(false);
              }}>
                Cancel
              </button>
            ) : null}
          </>
        )}
      </div>
      {(
        !secretsQuery.data?.wallhaven_saved
        || editingWallhavenKey
        || !secretsQuery.data?.danbooru_username
        && !secretsQuery.data?.danbooru_user_id
        && !secretsQuery.data?.danbooru_saved
        || editingDanbooru
      ) ? <div className="row">
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
        {secretsQuery.data?.danbooru_saved || secretsQuery.data?.danbooru_user_id ? (
          <button
            className="btn small"
            type="button"
            disabled={secretsMutation.isPending}
            onClick={() => secretsMutation.mutate({ clear_danbooru: true })}
          >
            Remove Danbooru credentials
          </button>
        ) : null}
      </div> : null}
    </div>
  );
}
