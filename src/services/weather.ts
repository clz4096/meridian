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

/** WMO weather-code → a compact icon + label. */
const WMO: Array<{ max: number; icon: string; label: string }> = [
  { max: 0, icon: '☀', label: 'Clear' },
  { max: 3, icon: '⛅', label: 'Partly cloudy' },
  { max: 48, icon: '🌫', label: 'Fog' },
  { max: 57, icon: '🌦', label: 'Drizzle' },
  { max: 67, icon: '🌧', label: 'Rain' },
  { max: 77, icon: '🌨', label: 'Snow' },
  { max: 82, icon: '🌧', label: 'Showers' },
  { max: 86, icon: '🌨', label: 'Snow showers' },
  { max: 99, icon: '⛈', label: 'Thunderstorm' },
];
const wmo = (code: number) => WMO.find((w) => code <= w.max) ?? WMO[WMO.length - 1]!;
export const weatherIcon = (code: number): string => wmo(code).icon;
export const weatherLabel = (code: number): string => wmo(code).label;

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
