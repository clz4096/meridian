import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BROOKLYN, WEATHER_MAX_AGE_MS, cachedWeather, forecastUrl, getWeather, isFresh, loadWeather, locationKey, setSavedCity,
  weatherIcon, weatherLabel, type Weather,
} from '@/services/weather';

describe('WMO weather-code mapping', () => {
  it('maps codes to the right label bucket', () => {
    expect(weatherLabel(0)).toBe('Clear');
    expect(weatherLabel(2)).toBe('Partly cloudy');
    expect(weatherLabel(45)).toBe('Fog');
    expect(weatherLabel(61)).toBe('Rain');
    expect(weatherLabel(71)).toBe('Snow');
    expect(weatherLabel(95)).toBe('Thunderstorm');
  });

  it('maps codes to an icon', () => {
    expect(weatherIcon(0)).toBe('☀');
    expect(weatherIcon(95)).toBe('⛈');
  });

  it('clamps an out-of-range code to the last bucket', () => {
    expect(weatherLabel(200)).toBe('Thunderstorm');
  });
});

/** A fixed clock: 2026-09-29 08:14 in New York. */
const NOW = Date.UTC(2026, 8, 29, 12, 14);

const forecast = (over: Record<string, unknown> = {}) => ({
  current: { temperature_2m: 63.6, weather_code: 61 },
  daily: {
    temperature_2m_max: [68.4],
    temperature_2m_min: [54.6],
    precipitation_probability_max: [40],
    precipitation_sum: [0.123],
  },
  ...over,
});
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe('getWeather', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn(async () => ok(forecast()));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('defaults to Brooklyn with one Open-Meteo call in °F and inches', async () => {
    const r = await getWeather(NOW);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe(String(BROOKLYN.lat));
    expect(url.searchParams.get('longitude')).toBe(String(BROOKLYN.lon));
    expect(url.searchParams.get('current')).toBe('temperature_2m,weather_code');
    expect(url.searchParams.get('daily')).toBe(
      'temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
    );
    expect(url.searchParams.get('temperature_unit')).toBe('fahrenheit');
    expect(url.searchParams.get('precipitation_unit')).toBe('inch');
    expect(url.searchParams.get('timezone')).toBe('America/New_York');
    expect(url.searchParams.get('forecast_days')).toBe('1');
    expect(r.source).toBe('fresh');
    expect(r.weather).toEqual({
      tempF: 64, code: 61, city: 'Brooklyn', at: NOW, highF: 68, lowF: 55, precipPct: 40, precipIn: 0.12, loc: 'brooklyn',
    });
  });

  it('serves the cache for 30 minutes, then fetches again', async () => {
    await getWeather(NOW);
    const r1 = await getWeather(NOW + WEATHER_MAX_AGE_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ weather: cachedWeather(), source: 'fresh' });
    const r2 = await getWeather(NOW + WEATHER_MAX_AGE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r2.weather?.at).toBe(NOW + WEATHER_MAX_AGE_MS);
  });

  it('force (the refresh tap) fetches even when the cache is fresh', async () => {
    await getWeather(NOW);
    await getWeather(NOW + 60_000, { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the cache, marked stale, when the fetch fails', async () => {
    await getWeather(NOW);
    fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    const r = await getWeather(NOW + WEATHER_MAX_AGE_MS + 1);
    expect(r.source).toBe('stale');
    expect(r.weather?.at).toBe(NOW);
  });

  it('offline: uses the cache without fetching, or reports none with no cache', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(await getWeather(NOW)).toEqual({ weather: null, source: 'none' });
    expect(fetchMock).not.toHaveBeenCalled();
    const old: Weather = { tempF: 50, code: 0, city: 'Brooklyn', at: NOW - 3 * 3_600_000, highF: 60, lowF: 40, loc: 'brooklyn' };
    localStorage.setItem('meridian_weather', JSON.stringify(old));
    expect(await getWeather(NOW)).toEqual({ weather: old, source: 'stale' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an error (not a cached zero) for a bad response with no cache', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(await getWeather(NOW)).toEqual({ weather: null, source: 'error' });
    fetchMock.mockImplementation(async () => ok(forecast({ current: {} })));
    expect(await getWeather(NOW)).toEqual({ weather: null, source: 'error' });
    expect(cachedWeather()).toBeNull();
  });

  it('a saved city is geocoded once, cached, and makes a Brooklyn reading stale', async () => {
    await getWeather(NOW);
    setSavedCity('Boston');
    fetchMock.mockImplementation(async (u: string) =>
      u.startsWith('https://geocoding-api.open-meteo.com/')
        ? ok({ results: [{ latitude: 42.36, longitude: -71.06, name: 'Boston' }] })
        : ok(forecast()),
    );
    const r = await getWeather(NOW + 60_000);
    expect(r.weather?.city).toBe('Boston');
    expect(r.weather?.loc).toBe(locationKey('Boston'));
    expect(fetchMock).toHaveBeenCalledTimes(3); // Brooklyn forecast, geocode, Boston forecast
    await getWeather(NOW + WEATHER_MAX_AGE_MS + 120_000);
    expect(fetchMock).toHaveBeenCalledTimes(4); // forecast only: the coordinates came from the cache
    expect(new URL(String(fetchMock.mock.calls[3]![0])).searchParams.get('latitude')).toBe('42.36');
  });

  it('treats a pre-Stage-4 cache (no forecast fields) and a clock moved backwards as stale', () => {
    const w: Weather = { tempF: 70, code: 0, city: 'Brooklyn', at: NOW, loc: 'brooklyn' };
    expect(isFresh(w, NOW + 1)).toBe(false);
    const full = { ...w, highF: 75 };
    expect(isFresh(full, NOW + 1)).toBe(true);
    expect(isFresh(full, NOW - 1)).toBe(false);
  });

  it("is never fresh across local midnight: the high and low are the previous day's", () => {
    const late = new Date(2026, 8, 29, 23, 50).getTime();
    const w: Weather = { tempF: 70, code: 0, city: 'Brooklyn', at: late, loc: 'brooklyn', highF: 75 };
    expect(isFresh(w, late + 5 * 60_000)).toBe(true); // 23:55, same day
    expect(isFresh(w, late + 20 * 60_000)).toBe(false); // 00:10, next day
  });

  it('keeps the old loadWeather entry point', async () => {
    expect((await loadWeather(NOW))?.tempF).toBe(64);
    expect(forecastUrl(1, 2)).toContain('latitude=1');
  });
});
