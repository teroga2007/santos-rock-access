import { useEffect, useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type Organization = { id: string; name: string };

export function CreateEvent({ userId, onCreated }: { userId: string; onCreated: () => void }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const client = supabase;
    async function load() {
      const members = await client.from('organization_members').select('organization_id').eq('user_id', userId).in('role', ['owner', 'admin']);
      if (members.error) { if (active) setError('No se pudo verificar el permiso para crear eventos. Recargue la página.'); return; }
      const ids = (members.data || []).map(member => member.organization_id);
      if (!ids.length) return;
      const result = await client.from('organizations').select('id,name').in('id', ids).order('name');
      if (!active) return;
      if (result.error) setError('No se pudieron cargar sus organizaciones. Recargue la página.');
      else setOrganizations(result.data || []);
    }
    load().catch(() => { if (active) setError('No se pudo verificar el permiso para crear eventos.'); });
    return () => { active = false; };
  }, [userId]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase || busy) return;
    const data = new FormData(e.currentTarget);
    const name = String(data.get('name') || '').trim();
    // datetime-local has no timezone: event times are explicitly Costa Rica (UTC-6).
    const start = new Date(`${data.get('start')}:00-06:00`);
    const endValue = String(data.get('end') || '');
    const end = endValue ? new Date(`${endValue}:00-06:00`) : null;
    if (name.length < 2 || name.length > 180) { setError('El nombre debe tener entre 2 y 180 caracteres.'); return; }
    if (!Number.isFinite(start.getTime()) || (end && (!Number.isFinite(end.getTime()) || end <= start))) {
      setError('Revise las fechas: el cierre debe ser posterior al inicio.'); return;
    }
    setBusy(true); setError(''); setSuccess(false);
    try {
      const { error: rpcError } = await supabase.rpc('create_event', {
        p_organization_id: String(data.get('organization')),
        p_name: name,
        p_starts_at: start.toISOString(),
        p_venue: String(data.get('venue') || '').trim() || null,
        p_ends_at: end?.toISOString() || null,
      });
      if (rpcError) {
        setError(rpcError.code === '42501' ? 'Su cuenta no tiene permiso para crear eventos en esta organización.' : 'No se pudo crear el evento. Revise la conexión y los datos antes de volver a intentar.');
        return;
      }
      setOpen(false); setSuccess(true); onCreated();
    } catch { setError('No se pudo confirmar la creación. Recargue la lista antes de intentar nuevamente para evitar duplicados.'); }
    finally { setBusy(false); }
  }

  return <section className="create-event" aria-label="Administración de eventos">
    {success && <p role="status" className="created-message">Evento creado como borrador. Actualizamos la lista de eventos.</p>}
    {!open && error && <p className="notice" role="alert">{error}</p>}
    {organizations.length > 0 && !open && <button className="btn primary create-button" onClick={() => { setOpen(true); setError(''); setSuccess(false); }}><Plus size={17}/> Crear evento</button>}
    {open && <div className="event-form-panel"><div className="form-heading"><h2>Nuevo evento</h2><button className="btn quiet" aria-label="Cerrar formulario" disabled={busy} onClick={() => setOpen(false)}><X size={18}/></button></div>
      <p>Las fechas se ingresan en hora de Costa Rica (UTC−6).</p>
      {error && <p className="notice" role="alert">{error}</p>}
      <form onSubmit={create}>
        <fieldset disabled={busy}>
          <label>Organización<select name="organization" required>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
          <label>Nombre del evento<input name="name" minLength={2} maxLength={180} required placeholder="Nombre del próximo evento"/></label>
          <label>Lugar (opcional)<input name="venue" maxLength={300} placeholder="Los Santos, Costa Rica"/></label>
          <div className="form-dates"><label>Inicio<input name="start" type="datetime-local" required/></label><label>Cierre (opcional)<input name="end" type="datetime-local"/></label></div>
          <button className="btn primary create-button" type="submit">{busy ? 'Creando…' : 'Crear borrador'}</button>
        </fieldset>
      </form>
    </div>}
  </section>;
}
