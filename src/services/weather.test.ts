import { describe, it, expect } from 'vitest';
import { weatherIcon, weatherLabel } from '@/services/weather';

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
