import { useEffect, useState } from 'react';
import { supabase } from './client';

export function EventStatus({ eventId, organizationId, userId, status, onChanged, blocked }: { eventId: string; organizationId: string; userId: string; status: string; onChanged: (status: string) => void; blocked: boolean }) {
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const next = status === 'draft' ? 'published' : status === 'published' ? 'live' : status === 'live' ? 'closed' : null;
  const label = status === 'draft' ? 'Publicar evento' : status === 'published' ? 'Iniciar ingreso' : 'Cerrar ingreso';
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    Promise.all([
      supabase.from('organization_members').select('role').eq('organization_id', organizationId).eq('user_id', userId),
      supabase.from('event_members').select('role').eq('event_id', eventId).eq('user_id', userId),
    ]).then(([org, event]) => { if (active) setAllowed(!org.error && !event.error && (!!org.data?.some(m => m.role === 'owner' || m.role === 'admin') || !!event.data?.some(m => m.role === 'admin'))); });
    return () => { active = false; };
  }, [eventId, organizationId, userId]);
  async function change() {
    if (!supabase || busy || blocked || !next) return;
    setBusy(true); setError('');
    try {
      const { error } = await supabase.rpc('set_event_status', { p_event_id: eventId, p_status: next });
      if (error) { setError('No se pudo cambiar el estado. Actualizá el evento y revisá tus permisos.'); return; }
      setConfirm(false); onChanged(next);
    } catch { setError('No se pudo confirmar el cambio. Recargá el evento antes de volver a intentar.'); }
    finally { setBusy(false); }
  }
  if (!allowed || !next) return null;
  return <div className="event-status-controls"><button className="quiet" disabled={busy || blocked} onClick={() => setConfirm(!confirm)}>{label}</button>{blocked && <p>Terminá la operación pendiente y guardá los QR antes de cambiar el estado.</p>}{confirm && <div className="notice"><p>{next === 'closed' ? 'Cerrar el ingreso impedirá nuevos canjes y emisiones. Esta aplicación no permite reabrir el evento.' : next === 'live' ? 'Al iniciar el ingreso, los QR válidos podrán canjearse desde este momento.' : 'El evento quedará publicado. El ingreso seguirá deshabilitado hasta que lo inicies.'}</p><button className="primary" disabled={busy || blocked} onClick={change}>{busy ? 'Guardando…' : `Confirmar: ${label.toLowerCase()}`}</button><button className="quiet" disabled={busy} onClick={() => setConfirm(false)}>Cancelar</button></div>}{error && <p role="alert" className="notice">{error}</p>}</div>;
}
