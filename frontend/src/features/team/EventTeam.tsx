import { useEffect, useState, type FormEvent } from 'react';
import { Users, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';

const roles = { admin: 'Administrador', supervisor: 'Supervisor', scanner: 'Personal de puerta' };
type Role = keyof typeof roles;
type Member = { user_id: string; role: string };

export function EventTeam({ eventId, organizationId, userId, expanded = false, onPendingChange }: { eventId: string; organizationId: string; userId: string; expanded?: boolean; onPendingChange?: (pending: boolean) => void }) {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(expanded);
  const [members, setMembers] = useState<Member[]>([]);
  const [assignments, setAssignments] = useState<Member[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [namesError, setNamesError] = useState(false);
  const [selected, setSelected] = useState('');
  const [role, setRole] = useState<Role>('scanner');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [newUser, setNewUser] = useState('');
  const [newRole, setNewRole] = useState<Role>('scanner');
  useEffect(() => { onPendingChange?.(busy); return () => onPendingChange?.(false); }, [busy, onPendingChange]);

  async function provision(e: FormEvent) {
    e.preventDefault();
    if (!supabase || busy) return;
    const id = newUser.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      setError('Ingrese un UUID de usuario válido.'); return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      const { error } = await supabase.rpc('provision_event_member', { p_event_id: eventId, p_user_id: id, p_role: newRole });
      if (error) {
        setError(error.code === 'PGRST202' ? 'Esta función no está disponible. Contacte al administrador.' : error.code === '42501' ? 'Solo un administrador de la organización puede incorporar personas.' : error.code === '23514' ? 'La cuenta debe tener una invitación válida.' : 'No se pudo incorporar la cuenta. Recargue el equipo antes de reintentar.');
        return;
      }
      setNewUser(''); setMessage('Cuenta incorporada y rol de evento guardado.'); setRevision(value => value + 1);
    } catch { setError('No se pudo confirmar el cambio. Recargue el equipo antes de reintentar.'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.from('organization_members').select('role').eq('organization_id', organizationId).eq('user_id', userId).then(({ data, error }) => {
      if (active) { setAllowed(!error && !!data?.some(m => m.role === 'owner' || m.role === 'admin')); if (error) setError('No se pudo verificar el permiso para administrar el equipo.'); }
    });
    return () => { active = false; };
  }, [organizationId, userId]);

  useEffect(() => {
    if (!open || !allowed || !supabase) return;
    const client = supabase;
    let active = true;
    setLoading(true); setError(''); setNames({}); setNamesError(false);
    Promise.all([
      client.from('organization_members').select('user_id,role').eq('organization_id', organizationId).order('created_at'),
      client.from('event_members').select('user_id,role').eq('event_id', eventId),
      client.from('profiles').select('user_id,display_name'),
    ]).then(([org, event, profiles]) => {
      if (!active) return;
      if (org.error || event.error) { setError('No se pudo cargar el equipo. Cierre y abra este panel para reintentar.'); setMembers([]); setAssignments([]); }
      else { setMembers(org.data || []); setAssignments(event.data || []); }
      setNames(Object.fromEntries((profiles.data || []).map(p => [p.user_id, p.display_name])));
      setNamesError(!!profiles.error);
      setLoading(false);
    }).catch(() => { if (active) { setError('No se pudo conectar para cargar el equipo.'); setLoading(false); } });
    return () => { active = false; };
  }, [open, allowed, organizationId, eventId, revision]);

  function choose(id: string) {
    setSelected(id); setMessage(''); setError('');
    setRole((assignments.find(m => m.user_id === id)?.role as Role) || 'scanner');
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!supabase || busy || !members.some(m => m.user_id === selected)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const { error } = await supabase.rpc('assign_event_member', { p_event_id: eventId, p_user_id: selected, p_role: role });
      if (error) { setError(error.code === '42501' ? 'No tiene permiso para administrar el equipo de este evento.' : error.code === '23514' ? 'La persona debe pertenecer a esta organización. Recargue el equipo.' : 'No se pudo guardar la asignación. Vuelva a cargar el equipo antes de reintentar.'); return; }
      setMessage('Rol guardado correctamente.'); setRevision(value => value + 1);
    } catch { setError('No se pudo confirmar el cambio. Vuelva a cargar el equipo antes de reintentar.'); }
    finally { setBusy(false); }
  }

  if (!allowed) return error ? <p role="alert">{error}</p> : null;
  return <div className="team">
    {!expanded && <button className="btn quiet" onClick={() => { setOpen(!open); setMessage(''); }} disabled={busy}><Users size={16}/>{open ? 'Cerrar equipo' : 'Administrar equipo'}</button>}
    {open && <section className="team-panel" aria-label="Equipo del evento"><div className="form-heading"><h3>Personas y permisos</h3>{!expanded && <button className="btn quiet" aria-label="Cerrar equipo" disabled={busy} onClick={() => setOpen(false)}><X size={16}/></button>}</div>

      <p>Los administradores de la organización mantienen acceso a todos los eventos.</p>
      {error && <div role="alert" className="notice">{error}</div>}
      {message && <p role="status" className="created-message">{message}</p>}
      {loading ? <p role="status">Cargando equipo…</p> : <>
        {namesError && <p role="status">No se pudieron cargar los nombres del equipo. Se muestran los identificadores disponibles.</p>}
        <ul className="team-list">{members.map(member => {
          const assigned = assignments.find(m => m.user_id === member.user_id);
          return <li key={member.user_id}><span className="member-id">{names[member.user_id] || 'Usuario sin nombre'}<small>{member.user_id === userId ? 'Usted' : member.user_id}</small></span><span>{assigned ? roles[assigned.role as Role] : 'Sin asignación'}<small>{member.role === 'owner' ? 'Propietario de organización' : member.role === 'admin' ? 'Administrador de organización' : 'Miembro de organización'}</small></span></li>;
        })}</ul>
        {!members.length ? <p>No hay miembros disponibles.</p> : <form onSubmit={save}><fieldset disabled={busy || !!error}>
          <label>Persona<select value={selected} onChange={e => choose(e.target.value)} required><option value="">Seleccione un miembro</option>{members.map(member => <option value={member.user_id} key={member.user_id}>{names[member.user_id] || member.user_id}{member.user_id === userId ? ' (usted)' : ''}</option>)}</select></label>
          <label>Rol en este evento<select value={role} onChange={e => setRole(e.target.value as Role)}>{Object.entries(roles).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <button className="btn primary" disabled={!selected || busy}>{busy ? 'Guardando…' : 'Guardar rol'}</button>
        </fieldset></form>}
        <details className="type-setup"><summary>Agregar una cuenta invitada</summary>
        <p>Use el ID de una cuenta ya invitada. Solo tendrá los permisos del rol elegido.</p>
        <form onSubmit={provision}><fieldset disabled={busy || loading}>
          <label>ID de usuario invitado<input value={newUser} onChange={e => setNewUser(e.target.value)} placeholder="ID de la cuenta invitada" required spellCheck={false} autoComplete="off"/></label>
          <label>Rol en este evento<select value={newRole} onChange={e => setNewRole(e.target.value as Role)}>{Object.entries(roles).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <button className="btn primary" disabled={!newUser.trim() || busy}>{busy ? 'Guardando…' : 'Incorporar al evento'}</button>
        </fieldset></form>
        </details>
      </>}
    </section>}
  </div>;
}
