import { useEffect, useState } from 'react';

export const mailTiming = 'La cola se revisa cada 15 minutos. El envío puede tardar más según los pendientes y el límite diario.';
export function useMailAvailability() {
  const [state, setState] = useState({ checking: true, ready: false, enabled: false, limit: 80 });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; const controller = new AbortController();
    setState(current => ({ ...current, checking: true }));
    fetch('/.netlify/functions/queue-ticket-emails', { cache: 'no-store', signal: controller.signal })
      .then(async response => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => { if (active) setState({ checking: false, ready: ok && data.configured === true, enabled: data.sending_enabled === true, limit: Number(data.daily_limit) || 80 }); })
      .catch(() => { if (active) setState(current => ({ ...current, checking: false, ready: false })); });
    return () => { active = false; controller.abort(); };
  }, [revision]);
  return { ...state, reload: () => setRevision(value => value + 1) };
}
export function validMail(value: string) { return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
