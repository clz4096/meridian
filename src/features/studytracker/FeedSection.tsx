/**
 * Today's reading — the tracker's single reading surface: a live, taste-ranked
 * list for a systems / distributed-systems / applied-CS-theory student, then the
 * Princeton theory group's papers, closed by one takeaway note. Hacker News
 * (Algolia API) is the sole discovery engine (Amendment A1); a curated eng-blog
 * allowlist ranks up. Collapsed by default; the feed fetches only once the
 * section is opened (served from a per-day cache after that); a refresh button
 * forces a re-fetch. See feedSources.ts for the fetch/rank/cache logic.
 */
import { useEffect, useState } from 'preact/hooks';
import { loadDailyFeed, type FeedItem } from '@/features/studytracker/feedSources';
import { Collapsible } from '@/features/studytracker/Collapsible';
import { ReadingNote } from '@/features/studytracker/ReadingNote';
import { PrincetonGroup } from '@/features/studytracker/PrincetonGroup';

export function FeedSection() {
  return (
    <Collapsible id="feed" eyebrow="Read" title="Today's reading" defaultOpen={false}>
      <FeedList />
      <PrincetonGroup />
      <ReadingNote id="feed" prompt="One takeaway from today's reading (optional — earns credit)" />
    </Collapsible>
  );
}

/** Rendered only while the section is open, so a collapsed section never fetches. */
function FeedList() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const load = (force: boolean): void => {
    setLoading(true);
    void loadDailyFeed(force).then((r) => {
      setItems(r.items);
      setFetchedAt(r.fetchedAt);
      setNote(r.error ?? (r.unchanged ? 'No new stories since the last update.' : null));
      setLoading(false);
    });
  };
  const time = (ms: number): string => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  useEffect(() => load(false), []);

  return (
    <>
      <div class="ptg-sub">Systems &amp; theory writing</div>
      <p class="hint">
        A daily dispatch of deep systems, distributed-systems and applied-CS-theory writing: this week's top Hacker News stories on that taste, with curated engineering blogs (Cloudflare, Dan Luu, Julia Evans, Russ Cox, the Morning Paper, Brendan Gregg) ranked to the top. New stories each day.
      </p>
      <div class="feed-bar">
        <span class="feed-when" role="status">
          {loading ? 'Refreshing…' : fetchedAt ? `Updated ${time(fetchedAt)}` : ''}
        </span>
        <button class="feed-refresh" type="button" onClick={() => load(true)} disabled={loading}>
          <span aria-hidden="true">↻</span> Refresh
        </button>
      </div>

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
    </>
  );
}
