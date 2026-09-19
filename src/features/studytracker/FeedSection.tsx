/**
 * Daily Reading — a section in the Study Tracker that shows a live, taste-ranked
 * reading list for a systems / distributed-systems / applied-CS-theory student.
 * Hacker News (Algolia API) is the sole discovery engine (Amendment A1); a
 * curated eng-blog allowlist ranks up. Fetches once on mount (served from a
 * per-day cache after that); a refresh button forces a re-fetch. See
 * feedSources.ts for the fetch/rank/cache logic.
 */
import { useEffect, useState } from 'preact/hooks';
import { loadDailyFeed, type FeedItem } from '@/features/studytracker/feedSources';
import { Collapsible } from '@/features/studytracker/Collapsible';
import { ReadingNote } from '@/features/studytracker/ReadingNote';

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
    <Collapsible id="feed" eyebrow="Read" title="Today's reading" defaultOpen={true}>
      <p class="hint">
        A daily dispatch of deep systems, distributed-systems and applied-CS-theory writing — top Hacker News stories on that taste, with curated engineering blogs (Cloudflare, Dan Luu, Julia Evans, Russ Cox, the Morning Paper, Brendan Gregg) ranked to the top.
        <button class="feed-refresh" type="button" onClick={() => load(true)} disabled={loading} aria-label="Refresh reading list">↻</button>
      </p>

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
                <span class="feed-src hn">HN</span>
                <span class="feed-body">
                  <span class="feed-title">{it.title}</span>
                  <span class="feed-meta">{it.meta}</span>
                  <span class="feed-meta feed-why">{it.why}</span>
                </span>
              </a>
            ))}
          </div>
        </>
      )}
      <ReadingNote id="feed" prompt="One takeaway from today's reading (optional — earns credit)" />
    </Collapsible>
  );
}
