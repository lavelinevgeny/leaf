import { useEffect, useRef, useState } from 'react';
import type { JournalController } from './journal-state.js';
type Reader = JournalController['readMedia'];
type ImageRecord = {
  src: string | null;
  error: boolean;
  refs: number;
  listeners: Set<() => void>;
  request: AbortController | null;
  pending: Promise<boolean> | null;
  reload(): Promise<boolean>;
};
// Only mounted consumers retain an entry. One URL/read per media/private reader.
const images = new WeakMap<Reader, Map<string, ImageRecord>>();
function imageRecord(
  reader: Reader,
  scope: string,
  projectId: string,
  taskId: string,
  mediaId: string,
  localFile?: File,
): { record: ImageRecord; release: () => void } {
  let entries = images.get(reader);
  if (!entries) {
    entries = new Map();
    images.set(reader, entries);
  }
  let record = entries.get(scope);
  if (!record) {
    const item: ImageRecord = {
      src: null,
      error: false,
      refs: 0,
      listeners: new Set(),
      request: null,
      pending: null,
      reload: () => {
        if (item.pending) return item.pending;
        const request = new AbortController();
        item.request = request;
        item.error = false;
        const run = async () => {
          try {
            const blob =
              localFile ??
              (await reader(projectId, taskId, mediaId, false, request.signal));
            if (!item.refs || request.signal.aborted) return false;
            if (!blob) throw Error('media');
            const src = URL.createObjectURL(blob);
            if (item.src) URL.revokeObjectURL(item.src);
            item.src = src;
            item.error = false;
            for (const notify of item.listeners) notify();
            return true;
          } catch {
            if (item.refs && !request.signal.aborted) {
              item.error = true;
              for (const notify of item.listeners) notify();
            }
            return false;
          } finally {
            item.pending = null;
          }
        };
        // Defer local File work too, so refs/listeners exist before publication.
        item.pending = Promise.resolve().then(run);
        return item.pending;
      },
    };
    record = item;
    entries.set(scope, item);
  }
  const held = record;
  held.refs++;
  return {
    record: held,
    release: () => {
      if (--held.refs === 0) {
        held.request?.abort();
        if (held.src) URL.revokeObjectURL(held.src);
        entries!.delete(scope);
      }
    },
  };
}
/** The controller supplies a stable reader for exactly one private epoch. */
export function useJournalImage(
  readMedia: Reader,
  projectId: string,
  taskId: string,
  mediaId: string | null,
  localFile?: File,
) {
  const scope = JSON.stringify([projectId, taskId, mediaId, !!localFile]);
  const [result, setResult] = useState<{
    scope: string;
    reader: Reader;
    src: string | null;
    error: boolean;
  } | null>(null);
  const owned = useRef<ImageRecord | null>(null);
  useEffect(() => {
    if (!mediaId) return;
    const lease = imageRecord(
      readMedia,
      scope,
      projectId,
      taskId,
      mediaId,
      localFile,
    );
    owned.current = lease.record;
    const update = () =>
      setResult({
        scope,
        reader: readMedia,
        src: lease.record.src,
        error: lease.record.error,
      });
    lease.record.listeners.add(update);
    update();
    if (!lease.record.src && !lease.record.pending) void lease.record.reload();
    return () => {
      owned.current = null;
      lease.record.listeners.delete(update);
      lease.release();
    };
  }, [readMedia, scope, localFile]);
  async function reload() {
    const record = owned.current;
    if (!record) return false;
    const ready = await record.reload();
    return ready && owned.current === record;
  }
  const current =
    result?.scope === scope && result.reader === readMedia ? result : null;
  return { src: current?.src ?? null, error: current?.error ?? false, reload };
}
