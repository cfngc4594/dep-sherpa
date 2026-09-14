'use client';

import { useEffect, useState } from 'react';
import { fetchLocalAvailability } from './local-client';
import type { LocalAvailability } from './local-report';

/**
 * Asks the server whether a local harness is attached. Hosted deployments
 * answer with an explicit reason; a dev server on the developer's machine
 * answers with its capabilities. The browser never assumes availability.
 */
export function useLocalCapabilities(): LocalAvailability {
  const [availability, setAvailability] = useState<LocalAvailability>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    void fetchLocalAvailability().then((next) => {
      if (!cancelled) setAvailability(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return availability;
}
