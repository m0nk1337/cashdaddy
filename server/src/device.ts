export type DevicePlatform = 'mobile' | 'desktop';

export type DeviceOs = 'android' | 'iphone' | 'other';

export interface DeviceInfo {
  platform: DevicePlatform;
  os: DeviceOs;
}

// Detect the visitor's device from the User-Agent header.
// Order matters: check mobile markers before desktop.
export function detectDevice(userAgent: string | undefined | null): DeviceInfo {
  const ua = (userAgent || '').toLowerCase();
  if (!ua) return { platform: 'desktop', os: 'other' };

  const isAndroid = ua.includes('android');
  const isIphone = ua.includes('iphone') || ua.includes('ipod');
  const isIpad = ua.includes('ipad') || (ua.includes('macintosh') && ua.includes('mobile'));
  const isMobile =
    isAndroid ||
    isIphone ||
    ua.includes('windows phone') ||
    ua.includes('blackberry') ||
    ua.includes('mobile');

  if (isAndroid) return { platform: 'mobile', os: 'android' };
  if (isIphone) return { platform: 'mobile', os: 'iphone' };
  if (isMobile || isIpad) return { platform: 'mobile', os: 'other' };
  return { platform: 'desktop', os: 'other' };
}

// Does a campaign's device targeting allow this visitor?
// Missing/empty device lists and "All" allow everyone. "Mobile"/"Desktop" are
// platform-level; "Android"/"iPhone" are OS-level. Unknown tags are ignored.
export function deviceAllowed(devices: string[] | undefined, device: DeviceInfo): boolean {
  if (!devices || devices.length === 0) return true;
  const tags = devices.map((d) => d.toLowerCase().trim()).filter((d) => d.length > 0);
  if (tags.length === 0) return true;
  if (tags.includes('all')) return true;
  if (tags.includes(device.platform)) return true;
  if (device.platform === 'mobile' && (tags.includes('android') || tags.includes('iphone'))) {
    return device.os === 'android' ? tags.includes('android') : tags.includes('iphone');
  }
  return false;
}
