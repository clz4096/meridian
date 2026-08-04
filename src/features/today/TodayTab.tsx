/**
 * Today — the home. A calm, read-only hero (greeting + clock left, weather
 * right), then today's agenda as a plain checkable todo list, two small quick
 * buttons (add a todo / capture an idea) that launch into Todos + Scratchpad,
 * and the tracker tiles. Reads dataRev + clockNow to re-derive.
 */
import { useEffect } from 'preact/hooks';
import { dstr } from '@/app/bootstrap';
import { dataRev, clockNow, weather } from '@/ui/store';
import type { HubStat } from '@/ui/hubTypes';
import { core, hubStats, openSection, todosActions, tickClock, refreshWeather, setWeatherCity } from '@/ui/actions';
import { dueTodos } from '@/features/todos/todosSelectors';
import { weatherSvg, weatherColor, cachedWeather } from '@/services/weather';

const TRACKERS = new Set(['meal', 'workout', 'knowledge', 'data']);
const toneColor = (t: HubStat['tone']): string | undefined =>
  t === 'cyan' ? 'var(--teal)' : t === 'kcal' ? 'var(--fuel)' : t === 'ok' ? 'var(--ok)' : undefined;

const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MO = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** Mono, uppercase date for the header eyebrow, e.g. "TUE · AUG 4". */
const monoDate = (ms: number): string => {
  const d = new Date(ms);
  return `${WD[d.getDay()]} · ${MO[d.getMonth()]} ${d.getDate()}`;
};

// Time-of-day glyph beside the date: sun by day, moon in the evening/night.
const SUN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M5 19l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M20.5 15.2A8.2 8.2 0 0 1 9.3 4 8.2 8.2 0 1 0 20.5 15.2z"/></svg>';
const todGlyph = (period: string): string => (period === 'day' || period === 'dawn' ? SUN : MOON);
const todColor = (period: string): string => (period === 'day' || period === 'dawn' ? 'var(--hub)' : '#AEBBDA');
/** The date eyebrow tints with the time of day so it stays legible over the glow. */
const eyebrowColor = (period: string): string =>
  period === 'dawn' ? '#EAD0A6' : period === 'day' ? '#C4D6EE' : period === 'dusk' ? '#EDC6AB' : '#BAC7E6';

/** Split the clock into hour:minute + seconds + am/pm so each can be styled. */
function clockParts(ms: number): { hm: string; ss: string; ap: string } {
  const d = new Date(ms);
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return { hm: `${h}:${String(d.getMinutes()).padStart(2, '0')}`, ss: String(d.getSeconds()).padStart(2, '0'), ap };
}

/** Time-of-day bucket that drives the ambient hero wash. */
const periodOf = (h: number): string => (h < 5 ? 'night' : h < 8 ? 'dawn' : h < 17 ? 'day' : h < 20 ? 'dusk' : 'night');

/** Spawn a tap ripple inside an action card. */
function ripple(e: PointerEvent): void {
  const btn = e.currentTarget as HTMLElement | null;
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const s = document.createElement('span');
  s.className = 'ripple';
  const size = Math.max(r.width, r.height) * 2;
  s.style.width = s.style.height = `${size}px`;
  s.style.left = `${e.clientX - r.left}px`;
  s.style.top = `${e.clientY - r.top}px`;
  btn.appendChild(s);
  window.setTimeout(() => s.remove(), 600);
}

export function TodayView() {
  const now = clockNow.value;
  const w = weather.value;
  dataRev.value; // subscribe: re-derive on store mutations

  useEffect(() => {
    if (!weather.value) weather.value = cachedWeather();
    void refreshWeather();
    const id = window.setInterval(tickClock, 1000); // tick every second (live seconds)
    return () => window.clearInterval(id);
  }, []);

  const today = dstr();
  const due = dueTodos(core(), today);
  const glance = hubStats().filter((s) => TRACKERS.has(s.key));
  const { hm, ss, ap } = clockParts(now);
  const tod = periodOf(new Date(now).getHours());

  return (
    <>
      <div class="today-wash" data-tod={tod} />
      <div class="today-body">
      <div class="today-hero">
        <div class="today-eyebrow" style={{ color: eyebrowColor(tod) }}>
          <span
            class="today-eyi"
            style={{ color: todColor(tod) }}
            dangerouslySetInnerHTML={{ __html: todGlyph(tod) }}
          />
          <span>{monoDate(now)}</span>
        </div>
        <div class="today-herorow">
          <div>
            <div class="today-time">
              {hm}
              <span class="today-secs">:{ss}</span>
              <span class="today-ampm">{ap}</span>
            </div>
          </div>
          <div class="today-wxblock" onClick={setWeatherCity} title="Set location">
            {w ? (
              <>
                <div class="today-wxt">
                  <span
                    class="today-wxi"
                    style={{ color: weatherColor(w.code) }}
                    dangerouslySetInnerHTML={{ __html: weatherSvg(w.code) }}
                  />
                  <span class="today-wxdeg">{w.tempF}°</span>
                </div>
                {w.city && <div class="today-wxc">{w.city}</div>}
              </>
            ) : (
              <div class="today-wxt today-wxset">📍 Set location</div>
            )}
          </div>
        </div>
        {w && (
          <div class="today-wxline" style={{ background: `linear-gradient(90deg, ${weatherColor(w.code)}55, transparent 72%)` }} />
        )}
      </div>

      {/* Today's agenda — a plain checkable list */}
      <div class="today-sec">Today</div>
      {due.length ? (
        due.map((t) => (
          <div class="todo-row">
            <button class="todo-chk" onClick={() => todosActions.toggle(String(t.id))} aria-label="Mark done" />
            <span class="todo-text">{t.text}</span>
            {t.due && t.due < today ? <span class="todo-due overdue">overdue</span> : <span class="todo-due today">today</span>}
          </div>
        ))
      ) : (
        <div class="empty">Nothing due — you’re clear.</div>
      )}

      {/* Two side-by-side quick actions: add a todo (neutral), capture an idea (warm) */}
      <div class="today-actions">
        <button class="today-qbtn" onPointerDown={ripple} onClick={() => openSection('todos')}>
          <span class="qi">＋</span>
          <span class="ql">Add a todo</span>
        </button>
        <button class="today-qbtn scratch" onPointerDown={ripple} onClick={() => openSection('scratch')}>
          <span class="qi">✎</span>
          <span class="ql">Capture an idea</span>
        </button>
      </div>

      <div class="today-sec">At a glance</div>
      <div class="today-tiles">
        {glance.map((s) => (
          <button class="tile" onClick={() => openSection(s.key)}>
            <span class="tile-l">{s.label}</span>
            <span class="tile-v" style={toneColor(s.tone) ? { color: toneColor(s.tone) } : undefined}>
              {s.dot && <span class="hdot" />}
              {s.value}
              {s.unit && <span class="tile-u">{s.unit}</span>}
            </span>
            <span class="tile-sub">{s.sub}</span>
          </button>
        ))}
      </div>
      </div>
    </>
  );
}
