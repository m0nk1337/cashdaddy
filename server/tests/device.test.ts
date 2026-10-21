import { describe, expect, it } from 'vitest';
import { detectDevice, deviceAllowed } from '../src/device';

describe('detectDevice', () => {
  it('detects Android phones as mobile/android', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
    expect(detectDevice(ua)).toEqual({ platform: 'mobile', os: 'android' });
  });

  it('detects iPhone as mobile/iphone', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(detectDevice(ua)).toEqual({ platform: 'mobile', os: 'iphone' });
  });

  it('detects iPad as mobile/other', () => {
    const ua = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(detectDevice(ua).platform).toBe('mobile');
  });

  it('treats desktop Linux/Windows/macOS as desktop', () => {
    expect(detectDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36').platform).toBe('desktop');
    expect(detectDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15').platform).toBe('desktop');
  });

  it('defaults to desktop for empty/missing UA', () => {
    expect(detectDevice(undefined)).toEqual({ platform: 'desktop', os: 'other' });
    expect(detectDevice('')).toEqual({ platform: 'desktop', os: 'other' });
  });
});

describe('deviceAllowed', () => {
  const mobile = { platform: 'mobile' as const, os: 'android' as const };
  const ios = { platform: 'mobile' as const, os: 'iphone' as const };
  const desktop = { platform: 'desktop' as const, os: 'other' as const };

  it('allows everyone when devices is missing, empty, or All', () => {
    expect(deviceAllowed(undefined, desktop)).toBe(true);
    expect(deviceAllowed([], mobile)).toBe(true);
    expect(deviceAllowed(['All'], desktop)).toBe(true);
    expect(deviceAllowed(['all'], mobile)).toBe(true);
  });

  it('matches platform-level Mobile/Desktop', () => {
    expect(deviceAllowed(['Mobile'], mobile)).toBe(true);
    expect(deviceAllowed(['Desktop'], desktop)).toBe(true);
    expect(deviceAllowed(['Mobile'], desktop)).toBe(false);
    expect(deviceAllowed(['Desktop'], mobile)).toBe(false);
  });

  it('matches OS-level Android/iPhone precisely', () => {
    expect(deviceAllowed(['Android'], mobile)).toBe(true);
    expect(deviceAllowed(['Android'], ios)).toBe(false);
    expect(deviceAllowed(['iPhone'], ios)).toBe(true);
    expect(deviceAllowed(['iPhone'], mobile)).toBe(false);
  });

  it('allows when any tag in the list matches', () => {
    expect(deviceAllowed(['Mobile', 'Android'], mobile)).toBe(true);
    // 'Mobile' is platform-level, so it allows any mobile visitor.
    expect(deviceAllowed(['Mobile', 'iPhone'], mobile)).toBe(true);
    expect(deviceAllowed(['Desktop', 'Android'], mobile)).toBe(true);
    expect(deviceAllowed(['Desktop', 'iPhone'], mobile)).toBe(false);
  });
});
