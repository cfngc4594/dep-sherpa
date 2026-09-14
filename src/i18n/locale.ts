export const localePreferences = ['system', 'en', 'zh-CN'] as const;
export type LocalePreference = (typeof localePreferences)[number];
export type ResolvedLocale = 'en' | 'zh-CN';

export const localeStorageKey = 'depsherpa:locale:v1';

export function isLocalePreference(value: string | null): value is LocalePreference {
  return value === 'system' || value === 'en' || value === 'zh-CN';
}

export function readStoredLocalePreference(storage: Pick<Storage, 'getItem'> | null): LocalePreference {
  if (!storage) return 'system';
  try {
    const stored = storage.getItem(localeStorageKey);
    return isLocalePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function writeStoredLocalePreference(
  storage: Pick<Storage, 'setItem'> | null,
  preference: LocalePreference,
): void {
  if (!storage) return;
  try {
    storage.setItem(localeStorageKey, preference);
  } catch {
    // Preference remains in memory when browser storage is unavailable.
  }
}

export function resolveLocale(
  preference: LocalePreference,
  languages: readonly string[] = [],
): ResolvedLocale {
  if (preference === 'en' || preference === 'zh-CN') return preference;
  return languages.some((language) => language.toLowerCase().startsWith('zh')) ? 'zh-CN' : 'en';
}

export function interpolate(
  template: string,
  values: Record<string, string | number> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}
