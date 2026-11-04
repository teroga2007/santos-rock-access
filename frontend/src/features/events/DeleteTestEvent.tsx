import { useEffect, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export function DeleteTestEvent({ eventId, eventName, blocked, onPendingChange }: {
  eventId: string; eventName: string; blocked: boolean; onPendingChange: (pending: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { onPendingChange(busy); return () => onPendingChange(false); }, [busy, onPendingChange]);
  async function remove(e: FormEvent) {
    e.preventDefault(); if (!supabase || busy || blocked || !confirmed || name !== eventName) return;
    setBusy(true); setError('');
    try {
      const { data, error } = await supabase.rpc('delete_test_event', { p_event_id: eventId, p_event_name: name, p_confirm_test_data: confirmed });
      if (error) {
        setError(error.code === '55000' ? 'Hay un correo en procesamiento. Espere a que termine y vuelva a intentar.' : error.code === '42501' ? 'El evento ya no está disponible o su cuenta no es propietaria. Revise la lista de eventos.' : 'No se pudo confirmar la eliminación. Revise la lista de eventos antes de reintentar.');
        return;
      }
      if (data?.deleted) window.location.assign('/');
      else setError('El evento ya no está disponible. Vuelva a la lista de eventos.');
    } catch { setError('No se pudo confirmar la eliminación. Revise la lista de eventos antes de reintentar.'); }
    finally { setBusy(false); }
  }
  return <details className="type-setup delete-event-panel"><summary><Trash2 size={16}/> Eliminar evento de prueba</summary>
    <p>Se eliminarán el evento, sus entradas, QR, lecturas, órdenes y registros financieros. Se conserva la auditoría. Esta acción es irreversible.</p>
    <form onSubmit={remove}><fieldset disabled={busy || blocked}>
      <label className="saved-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/> Confirmo que este evento y todas sus ventas son de prueba.</label>
      <label>Escriba el nombre exacto del evento<strong>{eventName}</strong><input value={name} onChange={e => setName(e.target.value)} autoComplete="off" spellCheck={false} required/></label>
      <button className="btn quiet danger-button" disabled={!confirmed || name !== eventName}><Trash2 size={16}/>{busy ? 'Eliminando…' : 'Eliminar evento y sus datos'}</button>
    </fieldset></form>
    {error && <p className="notice" role="alert">{error}</p>}
  </details>;
}
