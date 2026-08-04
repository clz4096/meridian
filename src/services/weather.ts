/**
 * Weather for the Today screen — Open-Meteo (free, no API key, CORS-friendly),
 * so nothing here needs a Supabase function or a secret. Browser-coupled (fetch +
 * geolocation + localStorage), like the adapters.
 *
 * Resolution order: a saved city wins (forward-geocoded); otherwise browser
 * geolocation (reverse-geocoded for a label). Any failure falls back to the last
 * cached reading, so a declined permission or offline still shows something.
 */

export interface Weather {
  tempF: number;
  code: number; // WMO weather code
  city: string;
  at: number; // fetch timestamp (ms)
}

const CACHE_KEY = 'meridian_weather';
const CITY_KEY = 'meridian_city';

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
    /* private mode — best effort */
  }
}

export function cachedWeather(): Weather | null {
  try {
    const s = localStorage.getItem(CACHE_KEY);
    return s ? (JSON.parse(s) as Weather) : null;
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

async function geocodeCity(name: string): Promise<{ lat: number; lon: number; label: string } | null> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`);
  const j = (await r.json()) as { results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string }> };
  const hit = j.results?.[0];
  return hit ? { lat: hit.latitude, lon: hit.longitude, label: hit.name } : null;
}

async function reverseCity(lat: number, lon: number): Promise<string> {
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    const j = (await r.json()) as { city?: string; locality?: string; principalSubdivision?: string };
    return j.city || j.locality || j.principalSubdivision || '';
  } catch {
    return '';
  }
}

async function fetchWeatherAt(lat: number, lon: number): Promise<{ tempF: number; code: number }> {
  const r = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`,
  );
  const j = (await r.json()) as { current?: { temperature_2m: number; weather_code: number } };
  return { tempF: Math.round(j.current?.temperature_2m ?? 0), code: j.current?.weather_code ?? 0 };
}

function geolocate(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 30 * 60 * 1000 },
    );
  });
}

/** Resolve the current weather, or the last cached reading on any failure. */
export async function loadWeather(now: number): Promise<Weather | null> {
  try {
    const city = savedCity();
    if (city) {
      const g = await geocodeCity(city);
      if (g) {
        const w = await fetchWeatherAt(g.lat, g.lon);
        const out: Weather = { ...w, city: g.label, at: now };
        cache(out);
        return out;
      }
    } else {
      const pos = await geolocate();
      if (pos) {
        const w = await fetchWeatherAt(pos.lat, pos.lon);
        const out: Weather = { ...w, city: await reverseCity(pos.lat, pos.lon), at: now };
        cache(out);
        return out;
      }
    }
  } catch {
    /* fall through to cache */
  }
  return cachedWeather();
}
