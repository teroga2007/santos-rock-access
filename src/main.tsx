import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session } from '@supabase/supabase-js';
import { ArrowRight, CalendarDays, Check, Guitar, LogOut, MapPin, ShieldCheck, Ticket, Users } from 'lucide-react';
import { supabase } from './client';
import './styles.css';
import { CreateEvent } from './CreateEvent';
import { EventTeam } from './EventTeam';
import { EventDetails } from './EventDetails';

type Event = { id: string; organization_id: string; name: string; venue: string | null; starts_at: string; status: string };
const statusNames: Record<string, string> = { draft: 'Borrador', published: 'Publicado', live: 'En vivo', closed: 'Finalizado', cancelled: 'Cancelado' };
const callback = new URL(window.location.href);
const callbackType = callback.searchParams.get('type') || new URLSearchParams(callback.hash.slice(1)).get('type');
const needsPassword = callbackType === 'invite' || callbackType === 'recovery' || window.location.pathname === '/auth/accept';
const detailId = /^\/events\/([^/]+)\/?$/.exec(window.location.pathname)?.[1];

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [passwordSetup, setPasswordSetup] = useState(needsPassword);
  const [events, setEvents] = useState<Event[]>([]);
  const [role, setRole] = useState('');
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState('asc');

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    const client = supabase;
    const { data: { subscription } } = client.auth.onAuthStateChange((event, current) => {
      setSession(current);
      if (event === 'PASSWORD_RECOVERY') setPasswordSetup(true);
    });
    async function initialize() {
      const token = callback.searchParams.get('token_hash');
      const code = callback.searchParams.get('code');
      let error;
      if (callback.searchParams.has('error') || new URLSearchParams(callback.hash.slice(1)).has('error')) {
        setMessage('El enlace no es válido o venció. Solicitá una nueva invitación.');
      }
      if (token && (callbackType === 'invite' || callbackType === 'recovery')) {
        ({ error } = await client.auth.verifyOtp({ token_hash: token, type: callbackType }));
      } else if (code) ({ error } = await client.auth.exchangeCodeForSession(code));
      if (error) setMessage('El enlace no es válido o venció. Solicitá una nueva invitación.');
      const { data, error: sessionError } = await client.auth.getSession();
      setSession(data.session);
      if (sessionError) setMessage('No se pudo recuperar la sesión. Intentá ingresar nuevamente.');
      if (code || token || callback.hash) window.history.replaceState({}, '', window.location.pathname);
      setLoading(false);
    }
    initialize().catch(() => { setMessage('No se pudo conectar con el servicio de autenticación.'); setLoading(false); });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setEvents([]); setRole('');
    if (!session || !supabase) return;
    let active = true;
    const client = supabase;
    setLoading(true);
    Promise.all([
      client.from('events').select('id,organization_id,name,venue,starts_at,status').order('starts_at'),
      client.from('organization_members').select('role').eq('user_id', session.user.id),
      client.from('event_members').select('role').eq('user_id', session.user.id),
    ]).then(([eventResult, orgResult, memberResult]) => {
      if (!active) return;
      if (eventResult.error || orgResult.error || memberResult.error) setMessage('No se pudieron cargar todos los permisos y eventos. Intentá recargar la página.');
      setEvents(eventResult.data || []);
      const roles = [...(orgResult.data || []), ...(memberResult.data || [])].map(m => m.role);
      setRole(roles.includes('owner') ? 'Propietario' : roles.includes('admin') ? 'Administrador' : roles.includes('supervisor') ? 'Supervisor' : roles.includes('scanner') ? 'Personal de puerta' : roles.includes('member') ? 'Miembro' : 'Sin asignación');
      setLoading(false);
    }).catch(() => { if (active) { setMessage('No se pudo conectar con Supabase.'); setLoading(false); } });
    return () => { active = false; };
  }, [session?.user.id, revision]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!supabase) return;
    const data = new FormData(e.currentTarget);
    setBusy(true); setMessage('');
    try {
      if (passwordSetup) {
        if (data.get('password') !== data.get('confirm')) { setMessage('Las contraseñas deben coincidir.'); return; }
        const { error } = await supabase.auth.updateUser({ password: String(data.get('password')) });
        if (error) { setMessage('No se pudo guardar la contraseña. Revisá los requisitos o solicitá un nuevo enlace.'); return; }
        setPasswordSetup(false); window.history.replaceState({}, '', '/');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: String(data.get('email')).trim(), password: String(data.get('password')) });
        if (error) setMessage('No pudimos iniciar sesión. Revisá tu correo y contraseña.');
      }
    } catch { setMessage('No se pudo conectar. Revisá tu conexión e intentá nuevamente.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    if (!supabase) return;
    setBusy(true);
    try { const { error } = await supabase.auth.signOut(); if (error) setMessage('No se pudo cerrar la sesión. Intentá nuevamente.'); else { setPasswordSetup(false); setMessage(''); } }
    catch { setMessage('No se pudo cerrar la sesión. Revisá tu conexión.'); }
    finally { setBusy(false); }
  }

  const brand = <a className="brand" href="/"><span className="brand-icon"><Guitar size={23}/></span><span>SANTOS ROCK<small>ACCESS / CONTROL DE ACCESO</small></span></a>;
  const visibleEvents = events.filter(event =>
    (!statusFilter || event.status === statusFilter) &&
    `${event.name} ${event.venue || ''}`.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))
  ).sort((a, b) => (new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()) * (sort === 'asc' ? 1 : -1));
  return <div className="app">
    <header>{brand}<span className="header-label"><span className="dot"/> HECHO PARA EL EN VIVO</span>{session && <button className="quiet" disabled={busy} onClick={logout}><LogOut size={16}/> Salir</button>}</header>
    {loading ? <main className="loading" role="status">Cargando tu espacio…</main> : session && !passwordSetup ? <main className="dashboard">
      {detailId ? <EventDetails eventId={detailId} userId={session.user.id}/> : <>
      <div className="eyebrow">ESPACIO DE TRABAJO / SANTOS ROCK</div>
      <div className="dashboard-heading"><div><h1>Tus eventos<span>.</span></h1><p>Todo listo para preparar el próximo encuentro.</p></div><span className="role"><ShieldCheck size={16}/>{role}</span></div>
      <div className="session"><span>Sesión de <strong>{session.user.email}</strong></span><span>Hora de Costa Rica · UTC−6</span></div>
      <CreateEvent key={session.user.id} userId={session.user.id} onCreated={() => setRevision(value => value + 1)}/>
      {message && <p className="notice" role="alert">{message}</p>}
      <div className="event-filters"><label>Buscar evento<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nombre o lugar"/></label><label>Estado<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">Todos los estados</option>{Object.entries(statusNames).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label><label>Orden<select value={sort} onChange={e => setSort(e.target.value)}><option value="asc">Fecha: primero los más antiguos</option><option value="desc">Fecha: primero los más recientes</option></select></label></div>
      <p role="status">{visibleEvents.length} de {events.length} eventos</p>
      <section className="events" aria-label="Eventos disponibles">{visibleEvents.length ? visibleEvents.map(event => <article className="event" key={event.id}>
        <div className="event-art"><Ticket size={52}/><span>SANTOS<br/>ROCK<span className="art-outline">LIVE</span></span><span className="badge">{statusNames[event.status] || event.status}</span></div>
        <div className="event-body"><h2><a href={`/events/${event.id}`}>{event.name}</a></h2><p><CalendarDays size={16}/>{new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', dateStyle: 'long', timeStyle: 'short' }).format(new Date(event.starts_at))}</p><p><MapPin size={16}/>{event.venue || 'Lugar por definir'}</p><div className="event-foot">Evento disponible para tu rol <Check size={16}/></div><a className="quiet detail-link" href={`/events/${event.id}`}>Ver detalles <ArrowRight size={16}/></a></div>
        <EventTeam eventId={event.id} organizationId={event.organization_id} userId={session.user.id}/>
      </article>) : <div className="empty"><CalendarDays size={36}/><h2>{events.length ? 'No hay eventos con estos filtros' : 'Todavía no tenés eventos asignados'}</h2><p>{events.length ? 'Probá con otro nombre, lugar o estado.' : 'Pedile al administrador que revise tu acceso a la organización o al evento.'}</p>{events.length > 0 && <button className="quiet" onClick={() => { setSearch(''); setStatusFilter(''); }}>Limpiar filtros</button>}</div>}</section>
      <div className="next"><ShieldCheck/><div><strong>Tu acceso, según tu rol</strong><p>Abrí un evento para consultar sus detalles y usar las herramientas disponibles para tu equipo. Cada ingreso se confirma en el servidor.</p></div></div>
      </>}
    </main> : <main className="auth-layout">
      <section className="intro"><div className="eyebrow"><span className="line"/> BACKSTAGE DIGITAL</div><h1>La música une.<br/>El acceso,<br/><span>lo hacemos fácil.</span></h1><p>El punto de encuentro de tu equipo para preparar cada evento de Santos Rock.</p><div className="features"><span><Ticket size={19}/> Un espacio para cada evento</span><span><Users size={19}/> Tu equipo, conectado</span><span><ShieldCheck size={19}/> Acceso seguro por invitación</span></div><div className="edition">LOS SANTOS, COSTA RICA <span>INDEPENDIENTE POR NATURALEZA ↗</span></div></section>
      <section className="auth-card"><div className="card-top"><span className="eyebrow">SOLO PARA EL EQUIPO</span><ShieldCheck size={23}/></div><h2>{passwordSetup ? 'Tu acceso empieza aquí.' : 'Bienvenido al equipo.'}</h2><p>{passwordSetup ? 'Definí una contraseña para tu cuenta invitada.' : 'Ingresá con tu cuenta para continuar.'}</p>
        {!supabase && <div className="notice">Configuración pendiente. Agregá la URL y la clave pública de Supabase en .env.local para habilitar el acceso.</div>}
        {message && <div className="notice" role="alert">{message}</div>}
        {passwordSetup && !session ? <div className="notice">Necesitás un enlace de invitación o recuperación válido. Solicitá uno nuevo al administrador.</div> : <form onSubmit={submit}>
          {!passwordSetup && <label>Correo electrónico<input name="email" type="email" placeholder="vos@ejemplo.com" autoComplete="username" required disabled={!supabase}/></label>}
          <label>{passwordSetup ? 'Nueva contraseña' : 'Contraseña'}<input name="password" type="password" placeholder="Tu contraseña" autoComplete={passwordSetup ? 'new-password' : 'current-password'} minLength={passwordSetup ? 12 : undefined} required disabled={!supabase}/></label>
          {passwordSetup && <><small>Usá al menos 12 caracteres.</small><label>Confirmá tu contraseña<input name="confirm" type="password" autoComplete="new-password" minLength={12} required/></label></>}
          <button className="primary" disabled={!supabase || busy}>{busy ? 'Un momento…' : passwordSetup ? 'Guardar contraseña' : 'Ingresar a mi espacio'}<ArrowRight size={18}/></button>
        </form>}
        <div className="invitation"><span>¿Todavía no tenés acceso?</span><p>Solicitá una invitación al administrador de Santos Rock.</p></div><div className="secure"><ShieldCheck size={14}/> Acceso exclusivo para personal autorizado</div>
      </section>
    </main>}
    <footer><span>© {new Date().getFullYear()} SANTOS ROCK</span><span>DETRÁS DE CADA GRAN NOCHE.</span><span>ACCESS <span className="footer-version">/ 01</span></span></footer>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
