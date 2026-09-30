/**
 * Today, block 1: the date and Brooklyn weather (docs/redesign-contract.md).
 *
 * Every state renders into one fixed-height body, so the skeleton, the reading, the
 * empty note and the error card are the same box and CLS stays 0. The reading comes
 * from the 30-minute cache when it can (services/weather.ts); returning to the app
 * with a stale cache, coming back online, or tapping Refresh fetches again.
 */
import { useEffect, useState } from 'preact/hooks';
import { clockMinute, weather } from '@/ui/store';
import { setWeatherCity } from '@/ui/actions';
import {
  cachedWeather,
  getWeather,
  isFresh,
  isTodaysForecast,
  weatherLabel,
  type Weather,
  type WeatherSource,
} from '@/services/weather';
import { longDate, savedWhen, shortDate } from './lazyContent';

type Status = 'loading' | 'ok' | 'offline' | 'empty' | 'error';

const statusOf = (s: WeatherSource): Status =>
  s === 'fresh' ? 'ok' : s === 'stale' ? 'offline' : s === 'none' ? 'empty' : 'error';

const deg = (n: number | undefined): string => (typeof n === 'number' ? `${n}°` : 'n/a');

export function WeatherBlock() {
  const now = clockMinute.value;
  const w = weather.value;
  const [status, setStatus] = useState<Status>(() => (weather.value ?? cachedWeather() ? 'ok' : 'loading'));
  const [busy, setBusy] = useState(false);

  const run = async (force: boolean): Promise<void> => {
    // Only a real fetch shows "Updating"; a fresh cache answers without one.
    if (force || !isFresh(cachedWeather(), Date.now())) setBusy(true);
    const r = await getWeather(Date.now(), { force });
    if (r.weather) weather.value = r.weather;
    setStatus(statusOf(r.source));
    setBusy(false);
  };

  useEffect(() => {
    if (!weather.value) weather.value = cachedWeather();
    void run(false);
    // getWeather skips the network while the cache is fresh, so these are cheap.
    const onVisible = (): void => {
      if (!document.hidden) void run(false);
    };
    const onOnline = (): void => void run(false);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  return (
    <section class="td-wx" aria-labelledby="td-date">
      <h1 class="td-date m-label" id="td-date">
        {longDate(now)}
      </h1>
      <div class="td-wx-body" aria-busy={status === 'loading'}>
        {w ? (
          // A reading on screen stays through a failed refresh, marked as not current.
          <Reading
            w={w}
            now={now}
            stale={status === 'offline' || status === 'error'}
            busy={busy}
            onRefresh={() => void run(true)}
          />
        ) : status === 'loading' ? (
          <WeatherSkeleton />
        ) : status === 'empty' || status === 'offline' ? (
          <div class="m-state td-wx-state" data-kind="empty">
            <p class="m-state-title">No weather yet.</p>
            <p class="m-state-body">It loads when you're back online.</p>
          </div>
        ) : (
          <div class="m-state td-wx-state" data-kind="error" role="alert">
            <p class="m-state-title">Weather didn't load.</p>
            <p class="m-state-body">The forecast service didn't answer.</p>
            <button type="button" class="m-btn" disabled={busy} onClick={() => void run(true)}>
              Try again
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The foot line under a reading. "Offline" only when the device says so; any other
 * failed refresh says that instead, since the network may be fine and the service not.
 * The date joins the time once the reading is from an earlier day.
 */
export function updatedNote(at: number, now: number, stale: boolean, online: boolean): string {
  const prefix = !stale ? '' : online ? "Couldn't refresh · " : 'Offline · ';
  return `${prefix}Updated ${savedWhen(at, now)}`;
}

function Reading(props: { w: Weather; now: number; stale: boolean; busy: boolean; onRefresh: () => void }) {
  const { w, now, stale, busy } = props;
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  // Yesterday's high, low and rain aren't today's: say which day they are for, in the
  // line that normally names the condition (same box, so no layout shift).
  const today = isTodaysForecast(w, now);
  const amount = typeof w.precipIn === 'number' ? w.precipIn.toFixed(2) : null;
  return (
    <>
      <div class="td-wx-main">
        <div class="td-wx-where">
          <button type="button" class="td-wx-place" onClick={setWeatherCity} aria-label={`${w.city || 'Weather'}: change location`}>
            {w.city || 'Weather'}
          </button>
          <p class="td-wx-cond">{today ? weatherLabel(w.code) : `Forecast from ${shortDate(w.at)}`}</p>
        </div>
        <p class="td-wx-temp m-num">
          {w.tempF}
          <span class="td-wx-unit">°F</span>
        </p>
      </div>
      <dl class="td-wx-grid m-num">
        <div>
          <dt class="m-label">High</dt>
          <dd>{deg(w.highF)}</dd>
        </div>
        <div>
          <dt class="m-label">Low</dt>
          <dd>{deg(w.lowF)}</dd>
        </div>
        <div>
          <dt class="m-label">Rain</dt>
          <dd>{typeof w.precipPct === 'number' ? `${w.precipPct}%` : 'n/a'}</dd>
        </div>
        <div>
          <dt class="m-label">Amount</dt>
          <dd>
            {amount ?? 'n/a'}
            {amount && <span class="td-wx-unit-sm"> in</span>}
          </dd>
        </div>
      </dl>
      <div class="td-wx-foot">
        <p class={stale ? 'm-state m-num' : 'td-wx-updated m-num'} data-kind={stale ? 'offline' : undefined}>
          {updatedNote(w.at, now, stale, online)}
        </p>
        <button type="button" class="m-btn m-btn-quiet td-wx-refresh" disabled={busy} onClick={props.onRefresh}>
          {busy ? 'Updating' : 'Refresh'}
        </button>
      </div>
    </>
  );
}

function WeatherSkeleton() {
  return (
    <div class="td-wx-skel" aria-label="Loading weather">
      <div class="td-wx-main">
        <div class="td-wx-where">
          <span class="m-skel m-skel-line td-w-40" />
          <span class="m-skel m-skel-line td-w-30" />
        </div>
        <span class="m-skel td-wx-skel-temp" />
      </div>
      <span class="m-skel td-wx-skel-grid" />
      <div class="td-wx-foot">
        <span class="m-skel m-skel-line td-w-30" />
      </div>
    </div>
  );
}
