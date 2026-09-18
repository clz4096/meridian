/**
 * Daily Reading — a section inside the Study Tracker that shows a live reading
 * list for a CS / C++ / math student (Hacker News + arXiv). Fetches once on
 * mount (served from a per-day cache after that); a refresh button forces a
 * re-fetch. See feed.ts for the fetch/cache logic.
 */
import { useEffect, useState } from 'preact/hooks';
import { loadDailyFeed, type FeedItem } from '@/features/studytracker/feedSources';

export function FeedSection() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const load = (force: boolean): void => {
    setLoading(true);
    void loadDailyFeed(force).then((r) => {
      setItems(r.items);
      setNote(r.error);
      setLoading(false);
    });
  };

  useEffect(() => load(false), []);

  return (
    <section class="feed">
      <div class="sec-h">
        <span class="eyebrow">Read</span>
        <span class="n">Today&apos;s reading</span>
        <button class="feed-refresh" type="button" onClick={() => load(true)} disabled={loading} aria-label="Refresh reading list">
          ↻
        </button>
      </div>
      <p class="hint">A daily dispatch for the CS/math student: top Hacker News on C++, compilers and algorithms, plus popular dev.to articles on C++, algorithms, and computer science.</p>

      {loading && items.length === 0 ? (
        <p class="feed-msg">Loading today&apos;s reading…</p>
      ) : items.length === 0 ? (
        <p class="feed-msg">{note ?? 'Nothing to show.'}</p>
      ) : (
        <>
          {note && <p class="feed-msg">{note}</p>}
          <div class="feed-list">
            {items.map((it) => (
              <a class="feed-item" key={it.url} href={it.url} target="_blank" rel="noopener noreferrer">
                <span class={'feed-src ' + (it.source === 'HN' ? 'hn' : 'dev')}>{it.source === 'HN' ? 'HN' : 'DEV'}</span>
                <span class="feed-body">
                  <span class="feed-title">{it.title}</span>
                  <span class="feed-meta">{it.meta}</span>
                </span>
              </a>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
