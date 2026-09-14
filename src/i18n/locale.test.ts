import { describe, expect, it } from 'vitest';
import { interpolate, isLocalePreference, resolveLocale } from './locale';

describe('locale preference', () => {
  it('accepts only the three public choices', () => {
    expect(isLocalePreference('system')).toBe(true);
    expect(isLocalePreference('en')).toBe(true);
    expect(isLocalePreference('zh-CN')).toBe(true);
    expect(isLocalePreference('zh')).toBe(false);
  });

  it('follows the system language when asked', () => {
    expect(resolveLocale('system', ['en-US'])).toBe('en');
    expect(resolveLocale('system', ['zh-CN', 'en'])).toBe('zh-CN');
    expect(resolveLocale('system', ['zh-TW'])).toBe('zh-CN');
    expect(resolveLocale('en', ['zh-CN'])).toBe('en');
    expect(resolveLocale('zh-CN', ['en-US'])).toBe('zh-CN');
  });

  it('fills message placeholders', () => {
    expect(interpolate('{package}@{version}', { package: 'zod', version: '4.1.5' })).toBe('zod@4.1.5');
  });
});
