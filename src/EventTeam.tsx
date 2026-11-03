import { useEffect, useState, type FormEvent } from 'react';
import { Users, X } from 'lucide-react';
import { supabase } from './client';

const roles = { admin: 'Administrador', supervisor: 'Supervisor', scanner: 'Personal de puerta' };
type Role = keyof typeof roles;
type Member = { user_id: string; role: string };

export function EventTeam({ eventId, organizationId, userId }: { eventId: string; organizationId: string; userId: string }) {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [assignments, setAssignments] = useState<Member[]>([]);
  const [selected, setSelected] = useState('');
  const [role, setRole] = useState<Role>('scanner');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [newUser, setNewUser] = useState('');
  const [newRole, setNewRole] = useState<Role>('scanner');

  async function provision(e: FormEvent) {
    e.preventDefault();
    if (!supabase || busy) return;
    const id = newUser.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      setError('Ingresá un UUID de usuario válido.'); return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      const { error } = await supabase.rpc('provision_event_member', { p_event_id: eventId, p_user_id: id, p_role: newRole });
      if (error) {
        setError(error.code === 'PGRST202' ? 'Aplicá las migraciones 004 y 005 en Supabase para habilitar esta función.' : error.code === '42501' ? 'Solo un administrador de la organización puede incorporar personas.' : error.code === '23514' ? 'La cuenta debe existir y haber sido invitada desde Supabase.' : 'No se pudo incorporar la cuenta. Recargá el equipo antes de reintentar.');
        return;
      }
      setNewUser(''); setMessage('Cuenta incorporada y rol de evento guardado.'); setRevision(value => value + 1);
    } catch { setError('No se pudo confirmar el cambio. Recargá el equipo antes de reintentar.'); }
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
    setLoading(true); setError('');
    Promise.all([
      client.from('organization_members').select('user_id,role').eq('organization_id', organizationId).order('created_at'),
      client.from('event_members').select('user_id,role').eq('event_id', eventId),
    ]).then(([org, event]) => {
      if (!active) return;
      if (org.error || event.error) { setError('No se pudo cargar el equipo. Cerrá y abrí este panel para reintentar.'); setMembers([]); setAssignments([]); }
      else { setMembers(org.data || []); setAssignments(event.data || []); }
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
      if (error) { setError(error.code === '42501' ? 'No tenés permiso para administrar el equipo de este evento.' : error.code === '23514' ? 'La persona debe pertenecer a esta organización. Recargá el equipo.' : 'No se pudo guardar la asignación. Volvé a cargar el equipo antes de reintentar.'); return; }
      setMessage('Rol guardado correctamente.'); setRevision(value => value + 1);
    } catch { setError('No se pudo confirmar el cambio. Volvé a cargar el equipo antes de reintentar.'); }
    finally { setBusy(false); }
  }

  if (!allowed) return error ? <p role="alert">{error}</p> : null;
  return <div className="team">
    <button className="quiet" onClick={() => { setOpen(!open); setMessage(''); }} disabled={busy}><Users size={16}/>{open ? 'Cerrar equipo' : 'Administrar equipo'}</button>
    {open && <section className="team-panel" aria-label="Equipo del evento"><div className="form-heading"><h3>Equipo del evento</h3><button className="quiet" aria-label="Cerrar equipo" disabled={busy} onClick={() => setOpen(false)}><X size={16}/></button></div>
      <p>Los roles de evento se asignan a miembros existentes de la organización.</p>
      <div className="notice">Los propietarios y administradores de organización conservan acceso administrativo a todos sus eventos, aunque se les asigne un rol de puerta aquí.</div>
      {error && <div role="alert" className="notice">{error}</div>}
      {message && <p role="status" className="created-message">{message}</p>}
      {loading ? <p role="status">Cargando equipo…</p> : <>
        <ul className="team-list">{members.map(member => {
          const assigned = assignments.find(m => m.user_id === member.user_id);
          return <li key={member.user_id}><span className="member-id">{member.user_id === userId ? 'Vos' : 'Miembro'}<small>{member.user_id}</small></span><span>{assigned ? roles[assigned.role as Role] : 'Sin asignación'}<small>{member.role === 'owner' ? 'Propietario de organización' : member.role === 'admin' ? 'Administrador de organización' : 'Miembro de organización'}</small></span></li>;
        })}</ul>
        {!members.length ? <p>No hay miembros disponibles.</p> : <form onSubmit={save}><fieldset disabled={busy || !!error}>
          <label>Persona<select value={selected} onChange={e => choose(e.target.value)} required><option value="">Seleccioná un miembro</option>{members.map(member => <option value={member.user_id} key={member.user_id}>{member.user_id === userId ? 'Vos — ' : ''}{member.user_id}</option>)}</select></label>
          <label>Rol en este evento<select value={role} onChange={e => setRole(e.target.value as Role)}>{Object.entries(roles).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <button className="primary" disabled={!selected || busy}>{busy ? 'Guardando…' : 'Guardar rol'}</button>
        </fieldset></form>}
        <h4>Incorporar una cuenta invitada</h4>
        <p>Primero invitá a la persona desde Supabase. Luego copiá su ID de usuario. Se incorporará como miembro básico y tendrá acceso a este evento según el rol elegido.</p>
        <form onSubmit={provision}><fieldset disabled={busy || loading}>
          <label>ID de usuario invitado<input value={newUser} onChange={e => setNewUser(e.target.value)} placeholder="UUID de Authentication → Users" required spellCheck={false} autoComplete="off"/></label>
          <label>Rol en este evento<select value={newRole} onChange={e => setNewRole(e.target.value as Role)}>{Object.entries(roles).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <button className="primary" disabled={!newUser.trim() || busy}>{busy ? 'Guardando…' : 'Incorporar al evento'}</button>
        </fieldset></form>
        <p>Las cuentas que ya sean propietarias o administradoras conservan sus permisos de organización. Este formulario no envía correos de invitación.</p>
      </>}
    </section>}
  </div>;
}
