import { useEffect, useRef, useState } from 'react';

interface ThumbProps {
  hash: string;
  alt?: string;
}

function retryDelay(value: string | null) {
  if (!value) return 1000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : 1000;
}

function failedLabel(name: string) {
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toUpperCase() : 'IMAGE';
}

export function Thumb({ hash, alt = '' }: ThumbProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [src, setSrc] = useState(`/api/thumb/${hash}`);
  const retrying = useRef(false);
  const objectUrl = useRef<string | null>(null);
  const img = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    retrying.current = false;
    setFailed(false);
    setLoaded(false);
    setSrc(`/api/thumb/${hash}`);
    const placeholder = () => {
      if (disposed) return;
      img.current?.closest('.cell')?.classList.remove('loading');
      if (objectUrl.current) {
        URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = null;
      }
      setFailed(true);
    };

    const retry = async () => {
      while (!disposed) {
        let response: Response;
        try {
          response = await fetch(new URL(`/api/thumb/${hash}`, window.location.origin), { signal: controller.signal });
        } catch {
          placeholder();
          return;
        }

        if (response.status !== 503) {
          if (!response.ok) {
            placeholder();
            return;
          }
          try {
            objectUrl.current = URL.createObjectURL(await response.blob());
          } catch {
            placeholder();
            return;
          }
          if (disposed) {
            URL.revokeObjectURL(objectUrl.current);
            objectUrl.current = null;
            return;
          }
          setSrc(objectUrl.current);
          return;
        }

        await new Promise((resolve) => window.setTimeout(resolve, retryDelay(response.headers.get('Retry-After'))));
      }
    };

    const onError = () => {
      if (retrying.current) {
        placeholder();
        return;
      }
      retrying.current = true;
      void retry();
    };

    const image = img.current;
    image?.addEventListener('error', onError);
    return () => {
      disposed = true;
      controller.abort();
      image?.removeEventListener('error', onError);
      if (objectUrl.current) {
        URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = null;
      }
    };
  }, [hash]);

  if (!hash) return <span />;
  if (failed) {
    return <span className="thumb-placeholder" data-thumb-hash={hash} data-thumb-name={alt}>{failedLabel(alt)}</span>;
  }

  return (
    <img
      ref={img}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      data-thumb-hash={hash}
      className={loaded ? 'loaded' : undefined}
      onLoad={() => {
        setLoaded(true);
        img.current?.closest('.cell')?.classList.remove('loading');
        if (objectUrl.current) {
          URL.revokeObjectURL(objectUrl.current);
          objectUrl.current = null;
        }
      }}
    />
  );
}
