import type { Ref } from 'react';
import type { TagTestResult } from '../schemas';

interface TagTesterProps {
  testerInput: string;
  testedFilename: string;
  testData: TagTestResult | undefined;
  testPending: boolean;
  testError: unknown;
  examples: string[];
  testerInputRef: Ref<HTMLInputElement>;
  onInput: (filename: string) => void;
  onExample: (filename: string) => void;
  messageOf: (error: unknown) => string;
}

function resultFolder(result: TagTestResult) {
  if (result.dest === 'INBOX') return 'Stays in the Inbox';
  if (result.dest === 'IGNORE') return 'Ignored (not an image)';
  return result.dest;
}

export function TagTester({
  testerInput,
  testedFilename,
  testData,
  testPending,
  testError,
  examples,
  testerInputRef,
  onInput,
  onExample,
  messageOf,
}: TagTesterProps) {
  const matches = new Set(testData?.matched.flatMap((keyword) => keyword.toLowerCase().split(/[^a-z0-9]+/)) ?? []);
  return (
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
          onChange={(event) => onInput(event.currentTarget.value)}
          onInput={(event) => onInput(event.currentTarget.value)}
        />
      </div>
      <div className="sugg">
        {examples.map((example) => (
          <button key={example} type="button" onClick={() => onExample(example)}>{example}</button>
        ))}
      </div>
      <div className="result">
        {testError ? <div className="error" role="alert">{messageOf(testError)}</div> : null}
        {testedFilename && testPending ? <div className="muted">Checking…</div> : null}
        {testData ? (
          <>
            <div>Words</div>
            <div className="words">
              {[...new Set(testData.words)].map((word) => (
                <span key={word} className={`tagchip${matches.has(word) ? ' hit' : ''}`}>{word}</span>
              ))}
            </div>
            <div>Rule</div><div>{testData.rule}</div>
            <div>Folder</div><div className="m">{resultFolder(testData)}</div>
            {testData.new_name ? <><div>New name</div><div className="m">{testData.new_name}</div></> : null}
            {testData.ignored ? <><div>Note</div><div className="muted">{testData.ignored}</div></> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
