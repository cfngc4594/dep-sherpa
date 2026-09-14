'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  interpolate,
  readStoredLocalePreference,
  resolveLocale,
  type LocalePreference,
  type ResolvedLocale,
  writeStoredLocalePreference,
} from './locale';
import { messages, type MessageKey } from './messages';

function browserLanguages(): string[] {
  if (typeof navigator === 'undefined') return [];
  return [...navigator.languages, navigator.language].filter(Boolean);
}

export function useLocale() {
  const [preference, setPreferenceState] = useState<LocalePreference>('system');
  const [languages, setLanguages] = useState<string[]>(['en']);

  useEffect(() => {
    setPreferenceState(readStoredLocalePreference(window.localStorage));
    setLanguages(browserLanguages());
    const onLanguageChange = () => setLanguages(browserLanguages());
    window.addEventListener('languagechange', onLanguageChange);
    return () => window.removeEventListener('languagechange', onLanguageChange);
  }, []);

  const locale = useMemo(() => resolveLocale(preference, languages), [preference, languages]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setPreference = useCallback((next: LocalePreference) => {
    setPreferenceState(next);
    writeStoredLocalePreference(window.localStorage, next);
  }, []);

  const t = useCallback((key: MessageKey, values?: Record<string, string | number>) => (
    interpolate(messages[locale][key], values)
  ), [locale]);

  return { preference, locale, setPreference, t };
}

export type Translate = ReturnType<typeof useLocale>['t'];
export type { LocalePreference, ResolvedLocale };
