export type EntrolightSettings = {
  backendEndpoint: string;
  surpriseQuantile: number;
};

export const DEFAULT_SETTINGS: EntrolightSettings = {
  backendEndpoint: "http://localhost:8000/api/v1/infer",
  surpriseQuantile: 0.95,
};

const SETTINGS_STORAGE_KEY = "entrolight:settings";

export async function loadSettings(): Promise<EntrolightSettings> {
  try {
    const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
    const raw = stored[SETTINGS_STORAGE_KEY] ?? {};
    return normalizeSettings(raw);
  } catch (error) {
    console.warn("entrolight settings: failed to load, using defaults", error);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(
  patch: Partial<EntrolightSettings>,
): Promise<EntrolightSettings> {
  const current = await loadSettings();
  const merged = normalizeSettings({ ...current, ...patch });
  await browser.storage.local.set({
    [SETTINGS_STORAGE_KEY]: merged,
  });
  return merged;
}

function normalizeSettings(candidate: Partial<EntrolightSettings>): EntrolightSettings {
  return {
    backendEndpoint: normalizeEndpoint(candidate.backendEndpoint),
    surpriseQuantile: normalizeQuantile(candidate.surpriseQuantile),
  };
}

function normalizeEndpoint(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_SETTINGS.backendEndpoint;
  }
  const trimmed = value.trim();
  return trimmed || DEFAULT_SETTINGS.backendEndpoint;
}

function normalizeQuantile(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_SETTINGS.surpriseQuantile;
  }
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.surpriseQuantile;
  }
  const clamped = Math.min(1, Math.max(0, value));
  return Number.isNaN(clamped) ? DEFAULT_SETTINGS.surpriseQuantile : clamped;
}
