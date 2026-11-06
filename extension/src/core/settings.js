import { DEFAULT_SETTINGS } from './defaults.js';

const KEYS = Object.keys(DEFAULT_SETTINGS);

/** 配置全部放在 chrome.storage.local（内容只在本地浏览器）。 */
export async function getSettings() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return { ...DEFAULT_SETTINGS };
  }
  const stored = await chrome.storage.local.get(KEYS);
  const merged = { ...DEFAULT_SETTINGS };
  for (const key of KEYS) {
    if (stored[key] !== undefined) merged[key] = stored[key];
  }
  return merged;
}

export async function saveSettings(patch) {
  const clean = {};
  for (const key of KEYS) {
    if (patch[key] !== undefined) clean[key] = patch[key];
  }
  await chrome.storage.local.set(clean);
  return getSettings();
}

export function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
