/**
 * Weather for the Today screen: Open-Meteo (free, no API key, CORS-friendly), so
 * nothing here needs a Supabase function or a secret. Browser-coupled (fetch +
 * localStorage), like the adapters. Contract: docs/redesign-contract.md, "Weather".
 *
 * Location: a saved city wins (forward-geocoded once, the coordinates cached with
 * it); otherwise Brooklyn, NY. There is no geolocation prompt.
 * Freshness: one forecast call, cached with its fetch time, and reused for 30
 * minutes. A failed or offline fetch falls back to the cache, so Today still shows
 * the last reading with its time.
 */
import { sameLocalDay } from '@/core/util';

export interface Weather {
  tempF: number;
  code: number; // WMO weather code
  city: string;
  at: number; // fetch timestamp (ms)
  /* Today's forecast. Optional because readings cached before the Stage 4 rebuild
     lack them; such a reading is treated as stale (see isFresh). */
  highF?: number;
  lowF?: number;
  /** Highest hourly precipitation probability today, 0 to 100. */
  precipPct?: number;
  /** Total precipitation expected today, inches. */
  precipIn?: number;
  /** Which location the reading is for, so changing the city makes the cache stale. */
  loc?: string;
}

/** The default location. */
export const BROOKLYN = { lat: 40.6782, lon: -73.9442, label: 'Brooklyn' } as const;
export const WEATHER_TZ = 'America/New_York';
/** A cached reading younger than this is shown without a new fetch. */
export const WEATHER_MAX_AGE_MS = 30 * 60_000;

const CACHE_KEY = 'meridian_weather';
const CITY_KEY = 'meridian_city';
const CITY_GEO_KEY = 'meridian_city_geo';

/** WMO weather-code → a compact icon + label + a condition colour. */
const WMO: Array<{ max: number; icon: string; label: string; color: string }> = [
  { max: 0, icon: '☀', label: 'Clear', color: '#F2B25C' }, // warm gold (sun)
  { max: 3, icon: '⛅', label: 'Partly cloudy', color: '#9FB6D6' }, // soft blue-grey
  { max: 48, icon: '🌫', label: 'Fog', color: '#8FA3BE' }, // slate
  { max: 57, icon: '🌦', label: 'Drizzle', color: '#7CC9EC' }, // teal
  { max: 67, icon: '🌧', label: 'Rain', color: '#5B9BE0' }, // blue
  { max: 77, icon: '🌨', label: 'Snow', color: '#BFE9FF' }, // pale ice
  { max: 82, icon: '🌧', label: 'Showers', color: '#5B9BE0' }, // blue
  { max: 86, icon: '🌨', label: 'Snow showers', color: '#BFE9FF' }, // pale ice
  { max: 99, icon: '⛈', label: 'Thunderstorm', color: '#A78BEA' }, // violet
];
const wmo = (code: number) => WMO.find((w) => code <= w.max) ?? WMO[WMO.length - 1]!;
export const weatherIcon = (code: number): string => wmo(code).icon;
export const weatherLabel = (code: number): string => wmo(code).label;
/** Colour the weather glyph by current condition, so the hero reads at a glance. */
export const weatherColor = (code: number): string => wmo(code).color;

/* Line-art weather glyphs (colourable via stroke, unlike emoji). Returned as an
   inline SVG string keyed by condition, drawn in the condition colour. */
const CLOUD = 'M7.5 17.5h8.2a3.6 3.6 0 0 0 .3-7.2A5 5 0 0 0 6.2 9 3.5 3.5 0 0 0 7.5 17.5z';
function glyph(code: number): string {
  if (code === 0) return `<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6"/>`;
  if (code <= 3) return `<circle cx="8" cy="7.5" r="2.8"/><path d="M8 2.4v1.4M2.4 7.5h1.4M4.3 3.8l1 1M11.7 3.8l-1 1"/><path d="${CLOUD}"/>`;
  if (code <= 48) return `<path d="${CLOUD}"/><path d="M6 20h5M13 20h5" opacity=".7"/>`;
  if (code <= 67 || (code >= 80 && code <= 82)) return `<path d="${CLOUD}"/><path d="M8.5 19.5l-1 2.2M12 19.5l-1 2.2M15.5 19.5l-1 2.2"/>`;
  if (code >= 95) return `<path d="${CLOUD}"/><path d="M12.5 18.5l-2.5 3.5h3l-2.5 3.5"/>`;
  return `<path d="${CLOUD}"/><circle cx="9" cy="20.5" r=".9" fill="currentColor" stroke="none"/><circle cx="12.5" cy="21.5" r=".9" fill="currentColor" stroke="none"/><circle cx="16" cy="20.5" r=".9" fill="currentColor" stroke="none"/>`;
}
export function weatherSvg(code: number, size = 22): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph(code)}</svg>`;
}

export function savedCity(): string {
  try {
    return localStorage.getItem(CITY_KEY) || '';
  } catch {
    return '';
  }
}
export function setSavedCity(city: string): void {
  try {
    if (city) localStorage.setItem(CITY_KEY, city);
    else localStorage.removeItem(CITY_KEY);
  } catch {
    /* private mode: best effort */
  }
}

/** Cache key of the location readings are fetched for right now. */
export function locationKey(city: string = savedCity()): string {
  const c = city.trim().toLowerCase();
  return c ? `city:${c}` : 'brooklyn';
}

export function cachedWeather(): Weather | null {
  try {
    const s = localStorage.getItem(CACHE_KEY);
    if (!s) return null;
    const w = JSON.parse(s) as Weather;
    return w && typeof w.tempF === 'number' && typeof w.at === 'number' ? w : null;
  } catch {
    return null;
  }
}
function cache(w: Weather): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(w));
  } catch {
    /* best effort */
  }
}

/** True when the reading's high, low and rain are for the day `now` falls on. */
export function isTodaysForecast(w: Weather, now: number): boolean {
  return sameLocalDay(w.at, now);
}

/** True when `w` can be shown without a new fetch: same location, has today's
 *  forecast fields, is under 30 minutes old, and was fetched today (a reading from
 *  23:50 holds yesterday's high and low at 00:10). A clock that moved backwards
 *  (negative age) counts as stale rather than fresh forever. */
export function isFresh(w: Weather | null, now: number, loc: string = locationKey()): boolean {
  if (!w || w.loc !== loc || typeof w.highF !== 'number') return false;
  const age = now - w.at;
  return age >= 0 && age < WEATHER_MAX_AGE_MS && isTodaysForecast(w, now);
}

/** The one Open-Meteo request (units and fields pinned by the contract). */
export function forecastUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    timezone: WEATHER_TZ,
    forecast_days: '1',
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}

interface Place {
  lat: number;
  lon: number;
  label: string;
}

async function geocodeCity(name: string): Promise<Place | null> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`);
  if (!r.ok) throw new Error('geocode HTTP ' + r.status);
  const j = (await r.json()) as { results?: Array<{ latitude: number; longitude: number; name: string }> };
  const hit = j.results?.[0];
  return hit ? { lat: hit.latitude, lon: hit.longitude, label: hit.name } : null;
}

/** Saved city (geocoded once, then from its cache) or Brooklyn. */
async function resolvePlace(city: string): Promise<Place> {
  if (!city) return BROOKLYN;
  try {
    const g = JSON.parse(localStorage.getItem(CITY_GEO_KEY) || 'null') as (Place & { q: string }) | null;
    if (g && g.q === city && Number.isFinite(g.lat) && Number.isFinite(g.lon)) return g;
  } catch {
    /* unreadable: geocode again */
  }
  const hit = await geocodeCity(city);
  // An unknown city shows Brooklyn under its own name, rather than an error that
  // would hide the weather until the city is changed.
  if (!hit) return BROOKLYN;
  try {
    localStorage.setItem(CITY_GEO_KEY, JSON.stringify({ ...hit, q: city }));
  } catch {
    /* best effort */
  }
  return hit;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function fetchForecast(p: Place): Promise<Omit<Weather, 'city' | 'at' | 'loc'>> {
  const r = await fetch(forecastUrl(p.lat, p.lon));
  // A failed or partial response must throw, not read as "0°, clear" (which was then cached).
  if (!r.ok) throw new Error('weather HTTP ' + r.status);
  const j = (await r.json()) as {
    current?: { temperature_2m?: unknown; weather_code?: unknown };
    daily?: {
      temperature_2m_max?: unknown[];
      temperature_2m_min?: unknown[];
      precipitation_probability_max?: unknown[];
      precipitation_sum?: unknown[];
    };
  };
  const t = num(j.current?.temperature_2m);
  if (t === null) throw new Error('weather: no current reading');
  const d = j.daily ?? {};
  const hi = num(d.temperature_2m_max?.[0]);
  const lo = num(d.temperature_2m_min?.[0]);
  const pp = num(d.precipitation_probability_max?.[0]);
  const pin = num(d.precipitation_sum?.[0]);
  return {
    tempF: Math.round(t),
    code: num(j.current?.weather_code) ?? 0,
    ...(hi !== null && { highF: Math.round(hi) }),
    ...(lo !== null && { lowF: Math.round(lo) }),
    ...(pp !== null && { precipPct: Math.round(pp) }),
    ...(pin !== null && { precipIn: Math.round(pin * 100) / 100 }),
  };
}

/**
 * Where a reading came from:
 * - `fresh`: fetched now, or a cache under 30 minutes old
 * - `stale`: the fetch failed or the device is offline, so this is the last cache
 * - `none`: offline with no cache (Today shows the empty state)
 * - `error`: the fetch failed while online and there is no cache
 */
export type WeatherSource = 'fresh' | 'stale' | 'none' | 'error';
export interface WeatherResult {
  weather: Weather | null;
  source: WeatherSource;
}

const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * The current reading. Fetches only when the cache is stale (older than 30 minutes,
 * another location, or missing today's forecast) or `force` is set (a tap on refresh).
 */
export async function getWeather(now: number, opts: { force?: boolean } = {}): Promise<WeatherResult> {
  const city = savedCity();
  const loc = locationKey(city);
  const cached = cachedWeather();
  if (!opts.force && isFresh(cached, now, loc)) return { weather: cached, source: 'fresh' };
  if (isOffline()) return { weather: cached, source: cached ? 'stale' : 'none' };
  try {
    const place = await resolvePlace(city);
    const w = await fetchForecast(place);
    const out: Weather = { ...w, city: place.label, at: now, loc };
    cache(out);
    return { weather: out, source: 'fresh' };
  } catch {
    return { weather: cached, source: cached ? 'stale' : 'error' };
  }
}

/** Resolve the current weather, or the last cached reading on any failure. */
export async function loadWeather(now: number): Promise<Weather | null> {
  return (await getWeather(now)).weather;
}
