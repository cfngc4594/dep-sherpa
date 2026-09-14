'use client';

import { Globe, Laptop } from 'lucide-react';
import type { Translate } from '../i18n/use-locale';
import type { LocalAvailability } from './local-report';

export type ExecutionMode = 'public' | 'local';

export interface ModeSwitchProps {
  t: Translate;
  mode: ExecutionMode;
  availability: LocalAvailability;
  onChange: (mode: ExecutionMode) => void;
}

/**
 * Two clearly separated entry points. The local mode stays selectable even when
 * unavailable so the page can explain why, but it is labelled as such.
 */
export function ModeSwitch({ t, mode, availability, onChange }: ModeSwitchProps) {
  const localHint = availability.status === 'enabled'
    ? t('modeLocalHint')
    : availability.status === 'checking'
      ? t('modeLocalHintChecking')
      : t('modeLocalHintUnavailable');
  return (
    <div className="mode-switch" role="group" aria-label={t('modeSwitchLabel')}>
      <button type="button" className={`mode-option ${mode === 'public' ? 'mode-option--active' : ''}`} aria-pressed={mode === 'public'} onClick={() => onChange('public')}>
        <Globe size={16} />
        <span><strong>{t('modePublic')}</strong><small>{t('modePublicHint')}</small></span>
      </button>
      <button type="button" className={`mode-option ${mode === 'local' ? 'mode-option--active' : ''} ${availability.status === 'enabled' ? '' : 'mode-option--unavailable'}`} aria-pressed={mode === 'local'} data-available={availability.status === 'enabled'} onClick={() => onChange('local')}>
        <Laptop size={16} />
        <span><strong>{t('modeLocalUpgrade')}</strong><small>{localHint}</small></span>
      </button>
    </div>
  );
}
