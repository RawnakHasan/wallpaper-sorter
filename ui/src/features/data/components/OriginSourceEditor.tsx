import { useState } from 'react';
import { siteSchema, type OriginLookupRequest, type Site } from '../schemas';

interface OriginSourceEditorProps {
  hash: string | null;
  source?: { site: string; id: string };
  pending: boolean;
  onSave: (request: { hash: string; site: Site; id: string }) => void;
  onLookup: (request: OriginLookupRequest) => void;
}

const sites: Site[] = [
  'Wallhaven',
  'Zerochan',
  'Konachan',
  'yande.re',
  'Danbooru',
  'Safebooru',
  'Pixiv',
  'Unknown',
];

function sourceSite(value?: string): Site {
  const label = value === 'YandeRe' ? 'yande.re' : value;
  const parsed = siteSchema.safeParse(label);
  return parsed.success ? parsed.data : 'Unknown';
}

function sourceFromLink(value: string): { site: Site; id: string } | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const path = url.pathname;
    let site: Site | null = null;
    let id: string | null = null;

    if (['wallhaven.cc', 'www.wallhaven.cc'].includes(host) && path.startsWith('/w/')) {
      site = 'Wallhaven';
      id = path.slice(3);
    } else if (host === 'whvn.cc') {
      site = 'Wallhaven';
      id = path.replace(/^\/+/, '');
    } else if (host === 'danbooru.donmai.us' && path.startsWith('/posts/')) {
      site = 'Danbooru';
      id = path.slice('/posts/'.length);
    } else if (['zerochan.net', 'www.zerochan.net'].includes(host) && /^\/\d+$/.test(path)) {
      site = 'Zerochan';
      id = path.slice(1);
    } else if (host === 'konachan.com' && path.startsWith('/post/show/')) {
      site = 'Konachan';
      id = path.slice('/post/show/'.length);
    } else if (host === 'yande.re' && path.startsWith('/post/show/')) {
      site = 'yande.re';
      id = path.slice('/post/show/'.length);
    } else if (host === 'safebooru.org' && url.searchParams.get('page') === 'post') {
      site = 'Safebooru';
      id = url.searchParams.get('id');
    } else if (host === 'www.pixiv.net' && path.startsWith('/artworks/')) {
      site = 'Pixiv';
      id = path.slice('/artworks/'.length);
    }

    return site && id && /^[a-z0-9]+$/i.test(id) ? { site, id } : null;
  } catch {
    return null;
  }
}

export function OriginSourceEditor({ hash, source, pending, onSave, onLookup }: OriginSourceEditorProps) {
  const [site, setSite] = useState<Site>(() => sourceSite(source?.site));
  const [id, setId] = useState(source?.id ?? '');
  const request = () => ({ hash: hash ?? '', site, id: id.trim() });
  const canLookup = ['Wallhaven', 'Danbooru', 'yande.re', 'Safebooru'].includes(site);

  return (
    <div className="field">
      <span className="lbl">Source</span>
      <div className="row">
        <select
          className="select"
          aria-label="Source site"
          value={site}
          disabled={pending}
          onChange={(event) => setSite(siteSchema.parse(event.currentTarget.value))}
        >
          {sites.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <input
          className="input"
          aria-label="Source ID or link"
          placeholder="ID or full site link"
          value={id}
          disabled={pending}
          onChange={(event) => {
            const value = event.currentTarget.value;
            const parsed = sourceFromLink(value);
            if (parsed) {
              setSite(parsed.site);
              setId(parsed.id);
            } else {
              setId(value);
            }
          }}
        />
        <button
          className="btn"
          type="button"
          disabled={pending || !hash}
          onClick={() => onSave(request())}
        >
          Save source
        </button>
        <button
          className="btn"
          type="button"
          disabled={pending || !hash || !id.trim() || !canLookup}
          onClick={() => onLookup(request())}
        >
          Look up tags
        </button>
      </div>
      {!canLookup ? <span className="faint">Metadata lookup is not available for this site yet.</span> : null}
    </div>
  );
}
