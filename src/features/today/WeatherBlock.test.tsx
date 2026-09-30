/**
 * WeatherBlock states with a mocked fetch and a fixed clock: loading, content,
 * fresh cache (no fetch), offline with a cache, offline without one (empty), and
 * error with Try again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { WeatherBlock } from '@/features/today/WeatherBlock';
import { clockTime } from '@/features/today/lazyContent';
import { weather, clockNow } from '@/ui/store';
import type { Weather } from '@/services/weather';

const NOW = new Date(2026, 8, 29, 8, 14).getTime(); // Tuesday 29 September, 8:14 local
const forecast = {
  current: { temperature_2m: 63.6, weather_code: 61 },
  daily: {
    temperature_2m_max: [68.4],
    temperature_2m_min: [54.6],
    precipitation_probability_max: [40],
    precipitation_sum: [0.123],
  },
};
const ok = () => Promise.resolve({ ok: true, status: 200, json: async () => forecast });
const cacheOf = (at: number): Weather => ({
  tempF: 58, code: 3, city: 'Brooklyn', at, highF: 61, lowF: 50, precipPct: 10, precipIn: 0, loc: 'brooklyn',
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  clockNow.value = NOW;
  weather.value = null;
  localStorage.clear();
  fetchMock = vi.fn(ok);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  weather.value = null;
});

describe('WeatherBlock', () => {
  it('shows the date, then a skeleton while the first fetch is out', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const { getByText, getByLabelText } = render(<WeatherBlock />);
    expect(getByText('Tuesday · 29 September')).toBeTruthy();
    expect(getByLabelText('Loading weather')).toBeTruthy();
  });

  it('content: Brooklyn now, high, low, rain chance and amount, update time', async () => {
    const { container, getByText } = render(<WeatherBlock />);
    await waitFor(() => expect(getByText('Brooklyn')).toBeTruthy());
    expect(container.querySelector('.td-wx-temp')!.textContent).toBe('64°F');
    expect(getByText('Rain', { selector: '.td-wx-cond' })).toBeTruthy();
    const cells = [...container.querySelectorAll('.td-wx-grid > div')].map((d) => d.textContent);
    expect(cells).toEqual(['High68°', 'Low55°', 'Rain40%', 'Amount0.12 in']);
    expect(getByText(`Updated ${clockTime(NOW)}`)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('a fresh cache (under 30 minutes) shows at once and skips the network', async () => {
    localStorage.setItem('meridian_weather', JSON.stringify(cacheOf(NOW - 10 * 60_000)));
    const { container } = render(<WeatherBlock />);
    expect(container.querySelector('.td-wx-temp')!.textContent).toBe('58°F');
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Refresh fetches even when the cache is fresh', async () => {
    localStorage.setItem('meridian_weather', JSON.stringify(cacheOf(NOW - 60_000)));
    const { container, getByText } = render(<WeatherBlock />);
    fireEvent.click(getByText('Refresh'));
    await waitFor(() => expect(container.querySelector('.td-wx-temp')!.textContent).toBe('64°F'));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('offline with a cache: the cached reading plus "Offline · Updated h:mm a", no error styling', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const at = NOW - 3 * 3_600_000;
    localStorage.setItem('meridian_weather', JSON.stringify(cacheOf(at)));
    const { getByText, queryByRole } = render(<WeatherBlock />);
    await waitFor(() => expect(getByText(`Offline · Updated ${clockTime(at)}`)).toBeTruthy());
    expect(getByText(`Offline · Updated ${clockTime(at)}`).dataset.kind).toBe('offline');
    expect(queryByRole('alert')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failed refresh while online says so, not "Offline"', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const at = NOW - 3 * 3_600_000;
    localStorage.setItem('meridian_weather', JSON.stringify(cacheOf(at)));
    const { getByText, queryByText, queryByRole } = render(<WeatherBlock />);
    await waitFor(() => expect(getByText(`Couldn't refresh · Updated ${clockTime(at)}`)).toBeTruthy());
    expect(getByText(`Couldn't refresh · Updated ${clockTime(at)}`).dataset.kind).toBe('offline');
    expect(queryByText(/Offline/)).toBeNull();
    expect(queryByRole('alert')).toBeNull();
  });

  it("a reading from a previous day names its day, and doesn't pass as today's", async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const at = new Date(2026, 8, 28, 21, 5).getTime(); // Monday evening
    localStorage.setItem('meridian_weather', JSON.stringify(cacheOf(at)));
    const { container, getByText } = render(<WeatherBlock />);
    await waitFor(() => expect(getByText('Offline · Updated Mon Sep 28, 9:05 PM')).toBeTruthy());
    expect(container.querySelector('.td-wx-cond')!.textContent).toBe('Forecast from Mon Sep 28');
  });

  it('a cache from 23:50 is refetched at 00:10, though it is only 20 minutes old', async () => {
    const midnight = new Date(2026, 8, 30, 0, 10).getTime();
    vi.setSystemTime(midnight);
    clockNow.value = midnight;
    localStorage.setItem('meridian_weather', JSON.stringify(cacheOf(midnight - 20 * 60_000)));
    const { container } = render(<WeatherBlock />);
    await waitFor(() => expect(container.querySelector('.td-wx-temp')!.textContent).toBe('64°F'));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('offline with no cache: the empty state', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { getByText } = render(<WeatherBlock />);
    await waitFor(() => expect(getByText('No weather yet.')).toBeTruthy());
  });

  it('error: says what failed; Try again (a 44px m-btn) fetches again', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    const { getByRole, getByText, container } = render(<WeatherBlock />);
    await waitFor(() => expect(getByRole('alert').textContent).toContain("Weather didn't load."));
    const btn = getByText('Try again');
    expect(btn.classList.contains('m-btn')).toBe(true);
    fetchMock.mockImplementation(ok);
    fireEvent.click(btn);
    await waitFor(() => expect(container.querySelector('.td-wx-temp')!.textContent).toBe('64°F'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returning to the foreground with a stale cache fetches again', async () => {
    localStorage.setItem('meridian_weather', JSON.stringify(cacheOf(NOW - 10 * 60_000)));
    render(<WeatherBlock />);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.setSystemTime(NOW + 31 * 60_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  });
});
