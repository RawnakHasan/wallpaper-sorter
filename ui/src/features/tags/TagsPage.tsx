import { TagEditor } from './components/TagEditor';
import { TagTester } from './components/TagTester';
import { useTagsPage } from './hooks/useTagsPage';
import type { Tag } from './schemas';

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function TagsPage() {
  const {
    tagsQuery,
    foldersQuery,
    statusQuery,
    testQuery,
    testerInput,
    testedFilename,
    testerInputRef,
    editingTag,
    tagError,
    saveMutation,
    deleteMutation,
    openEditor,
    submitTag,
    removeTag,
    setExample,
    updateTesterInput,
    closeEditor,
  } = useTagsPage();

  const queryError = tagsQuery.error ?? foldersQuery.error ?? statusQuery.error;
  if (queryError) {
    return (
      <div className="page tags-page">
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
  const examples = [
    tags[0]?.keywords[0] ? `${tags[0].keywords[0]}.png` : null,
    'wallhaven-1q2le9.jpg',
  ].filter((example): example is string => example !== null);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Tags</h1>
        <span className="sub">{plural(tags.length, 'tag')} in {plural(groupedTags.length, 'folder')}</span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => openEditor(null)}>Add tag</button>
      </div>
      <div className="tags-layout">
        <div className="tags-list">
          {tags.length ? groupedTags.map(([destination, group]) => (
            <section className="tag-group panel" key={destination}>
              <div className="tag-group-head">
                <h2 className="mono">{destination}</h2>
                <span className="pill">Prefix <b>{group[0].effective_prefix}</b></span>
              </div>
              {group.map((tag) => (
                <div className="tagrow" key={tag.index}>
                  <div className="kws">
                    {tag.keywords.map((keyword) => <span className="tagchip mono" key={keyword}>{keyword}</span>)}
                    {tag.match === 'substring' ? <span className="chip c-ac">inside words</span> : null}
                    {tag.strict_words.length ? <span className="chip c-wn">needs: {tag.strict_words.join(', ')}</span> : null}
                    {tag.generic ? <span className="chip c-ac">generic</span> : null}
                    {tag.prefix ? <span className="chip">prefix: {tag.prefix}</span> : null}
                  </div>
                  <button className="link-button" onClick={() => openEditor(tag)}>Edit</button>
                  <button className="link-button danger-link" disabled={deleteMutation.isPending} onClick={() => { void removeTag(tag); }}>Delete</button>
                </div>
              ))}
            </section>
          )) : (
            <div className="empty panel">
              <b>No tags yet</b>
              A tag says which folder an image goes to when its name contains a keyword.
            </div>
          )}
        </div>
        <aside className="tag-tester-sticky">
          <TagTester
            testerInput={testerInput}
            testedFilename={testedFilename}
            testData={testQuery.data}
            testPending={testQuery.isPending}
            testError={testQuery.error}
            examples={examples}
            testerInputRef={testerInputRef}
            onInput={updateTesterInput}
            onExample={setExample}
            messageOf={messageOf}
          />
        </aside>
      </div>
      {editingTag !== undefined ? (
        <TagEditor
          key={editingTag?.index ?? 'new'}
          tag={editingTag}
          folders={folders}
          duplicateFolder={duplicateFolder}
          pending={saveMutation.isPending}
          error={tagError}
          onClose={closeEditor}
          onSave={submitTag}
        />
      ) : null}
    </div>
  );
}
