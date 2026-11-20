import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmDialog } from '../../components/dialogs';
import { getStatus, statusQueryKey } from '../status/api';
import { useToastStore } from '../../stores/toast';
import { deleteTag, getTagFolders, getTags, saveTag, tagFoldersQueryKey, tagsQueryKey, testTagName } from './api';
import { TagEditor } from './components/TagEditor';
import type { Tag, TagRequest, TagTestResult } from './schemas';

let lastTestedFilename = '';

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function resultFolder(result: TagTestResult) {
  if (result.dest === 'INBOX') return 'Stays in the Inbox';
  if (result.dest === 'IGNORE') return 'Ignored (not an image)';
  return result.dest;
}

export function TagsPage() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const [editingTag, setEditingTag] = useState<Tag | null | undefined>(undefined);
  const [tagError, setTagError] = useState<string | null>(null);
  const [testerInput, setTesterInput] = useState(lastTestedFilename);
  const [testedFilename, setTestedFilename] = useState(lastTestedFilename.trim());
  const testerInputRef = useRef<HTMLInputElement>(null);
  const tagsQuery = useQuery({ queryKey: tagsQueryKey, queryFn: getTags });
  const foldersQuery = useQuery({ queryKey: tagFoldersQueryKey, queryFn: getTagFolders });
  const statusQuery = useQuery({ queryKey: statusQueryKey, queryFn: getStatus });
  const testQuery = useQuery({
    queryKey: ['tag-test', testedFilename],
    queryFn: () => testTagName(testedFilename),
    enabled: testedFilename !== '',
    retry: false,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setTestedFilename(testerInput.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [testerInput]);

  const refreshPageData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: tagsQueryKey }),
      queryClient.invalidateQueries({ queryKey: tagFoldersQueryKey }),
      queryClient.invalidateQueries({ queryKey: statusQueryKey }),
    ]);
  };
  const saveMutation = useMutation({
    mutationFn: ({ index, request }: { index: number | null; request: TagRequest }) => saveTag(index, request),
    onSuccess: async () => {
      setEditingTag(undefined);
      showToast('Tag saved. Waiting images that match are sorted now.');
      await refreshPageData();
    },
    onError: (error) => setTagError(messageOf(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: ({ tag }: { tag: Tag }) => deleteTag(tag.index, tag.keywords, tag.dest),
    onSuccess: async () => {
      showToast('Tag deleted');
      await refreshPageData();
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });

  const queryError = tagsQuery.error ?? foldersQuery.error ?? statusQuery.error;
  if (queryError) {
    return (
      <div className="page">
        <p className="error" role="alert">{messageOf(queryError)}</p>
        <button className="btn" onClick={() => { void tagsQuery.refetch(); void foldersQuery.refetch(); void statusQuery.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (!tagsQuery.data || !foldersQuery.data || !statusQuery.data) return <div className="page"><p className="muted">Loading…</p></div>;

  const tags = tagsQuery.data;
  const folders = foldersQuery.data;
  const duplicateFolder = statusQuery.data.settings.duplicates_folder;
  const groupedTags = [...tags.reduce((groups, tag) => {
    groups.set(tag.dest, [...(groups.get(tag.dest) ?? []), tag]);
    return groups;
  }, new Map<string, Tag[]>())].sort(([left], [right]) => left.localeCompare(right));
  const openEditor = (tag: Tag | null) => {
    setTagError(null);
    setEditingTag(tag);
  };
  const submitTag = (request: TagRequest) => {
    setTagError(null);
    saveMutation.mutate({ index: editingTag?.index ?? null, request });
  };
  const removeTag = async (tag: Tag) => {
    const confirmed = await confirmDialog(
      `Delete the tag “${tag.keywords.join(', ')}”? Images already sorted stay where they are.`,
      'Delete tag',
      true,
    );
    if (confirmed) deleteMutation.mutate({ tag });
  };
  const setExample = (filename: string) => {
    lastTestedFilename = filename;
    setTesterInput(filename);
    setTestedFilename(filename.trim());
    if (testerInputRef.current) testerInputRef.current.value = filename;
  };
  const updateTesterInput = (filename: string) => {
    lastTestedFilename = filename;
    setTesterInput(filename);
  };
  const examples = [
    tags[0]?.keywords[0] ? `${tags[0].keywords[0]}.png` : null,
    'wallhaven-1q2le9.jpg',
  ].filter((example): example is string => example !== null);
  const matches = new Set(
    testQuery.data?.matched.flatMap((keyword) => keyword.toLowerCase().split(/[^a-z0-9]+/)) ?? [],
  );

  return (
    <div className="page">
      <div className="page-head">
        <h1>Tags</h1>
        <span className="sub">{plural(tags.length, 'tag')} in {plural(groupedTags.length, 'folder')}</span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => openEditor(null)}>Add tag</button>
      </div>
      <div className="panel tester">
        <h2>Try a filename</h2>
        <div className="field">
          <input
            ref={testerInputRef}
            className="input wide"
            id="tester-in"
            placeholder="Paste a filename to see where it would go"
            aria-label="Filename to test"
            value={testerInput}
            onChange={(event) => updateTesterInput(event.currentTarget.value)}
            onInput={(event) => updateTesterInput(event.currentTarget.value)}
          />
        </div>
        <div className="sugg">
          {examples.map((example) => (
            <button key={example} type="button" onClick={() => setExample(example)}>{example}</button>
          ))}
        </div>
        <div className="result">
          {testQuery.error ? <div className="error" role="alert">{messageOf(testQuery.error)}</div> : null}
          {testedFilename && testQuery.isPending ? <div className="muted">Checking…</div> : null}
          {testQuery.data ? (
            <>
              <div>Words</div>
              <div className="words">
                {[...new Set(testQuery.data.words)].map((word) => (
                  <span key={word} className={`tagchip${matches.has(word) ? ' hit' : ''}`}>{word}</span>
                ))}
              </div>
              <div>Rule</div>
              <div>{testQuery.data.rule}</div>
              <div>Folder</div>
              <div className="m">{resultFolder(testQuery.data)}</div>
              {testQuery.data.new_name ? (
                <>
                  <div>New name</div>
                  <div className="m">{testQuery.data.new_name}</div>
                </>
              ) : null}
              {testQuery.data.ignored ? (
                <>
                  <div>Note</div>
                  <div className="muted">{testQuery.data.ignored}</div>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      {tags.length ? groupedTags.map(([destination, group]) => (
        <section key={destination}>
          <div className="group-head">
            <h2 className="m">{destination}</h2>
            <span className="muted">files are named “{group[0].effective_prefix} N”</span>
          </div>
          {group.map((tag) => (
            <div className="tagrow" key={tag.index}>
              <div className="kws">
                {tag.keywords.map((keyword) => <span className="tagchip" key={keyword}>{keyword}</span>)}
                {tag.match === 'substring' ? <span className="badge">inside words</span> : null}
                {tag.strict_words.length ? <span className="badge">needs: {tag.strict_words.join(', ')}</span> : null}
                {tag.generic ? <span className="badge warn">generic</span> : null}
                {tag.prefix ? <span className="badge">prefix: {tag.prefix}</span> : null}
              </div>
              <button className="btn small" onClick={() => openEditor(tag)}>Edit</button>
              <button className="btn small danger" disabled={deleteMutation.isPending} onClick={() => { void removeTag(tag); }}>Delete</button>
            </div>
          ))}
        </section>
      )) : (
        <div className="empty">
          <b>No tags yet</b>
          A tag says which folder an image goes to when its name contains a keyword.
        </div>
      )}
      {editingTag !== undefined ? (
        <TagEditor
          key={editingTag?.index ?? 'new'}
          tag={editingTag}
          folders={folders}
          duplicateFolder={duplicateFolder}
          pending={saveMutation.isPending}
          error={tagError}
          onClose={() => {
            if (saveMutation.isPending) return;
            setEditingTag(undefined);
            setTagError(null);
          }}
          onSave={submitTag}
        />
      ) : null}
    </div>
  );
}
