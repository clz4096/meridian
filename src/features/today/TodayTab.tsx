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
import { weatherIcon, cachedWeather } from '@/services/weather';

const TRACKERS = new Set(['meal', 'workout', 'knowledge', 'data']);
const toneColor = (t: HubStat['tone']): string | undefined =>
  t === 'cyan' ? 'var(--teal)' : t === 'kcal' ? 'var(--fuel)' : t === 'ok' ? 'var(--ok)' : undefined;

const fmtTime = (ms: number): string => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const fmtDate = (ms: number): string => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const greeting = (h: number): string => (h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');

export function TodayView() {
  const now = clockNow.value;
  const w = weather.value;
  dataRev.value; // subscribe: re-derive on store mutations

  useEffect(() => {
    if (!weather.value) weather.value = cachedWeather();
    void refreshWeather();
    const id = window.setInterval(tickClock, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const today = dstr();
  const due = dueTodos(core(), today);
  const glance = hubStats().filter((s) => TRACKERS.has(s.key));

  return (
    <>
      <div class="today-hero">
        <div class="today-greet">{greeting(new Date(now).getHours())}</div>
        <div class="today-herorow">
          <div>
            <div class="today-time">{fmtTime(now)}</div>
            <div class="today-date">{fmtDate(now)}</div>
          </div>
          <div class="today-wxblock" onClick={setWeatherCity} title="Set location">
            {w ? (
              <>
                <div class="today-wxt">
                  {weatherIcon(w.code)} {w.tempF}°
                </div>
                {w.city && <div class="today-wxc">{w.city}</div>}
              </>
            ) : (
              <div class="today-wxt today-wxset">📍 Set location</div>
            )}
          </div>
        </div>
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
        <button class="today-qbtn" onClick={() => openSection('todos')}>
          <span class="qi">＋</span>
          <span class="ql">Add a todo</span>
        </button>
        <button class="today-qbtn scratch" onClick={() => openSection('scratch')}>
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
    </>
  );
}
