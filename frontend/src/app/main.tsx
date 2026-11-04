import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session } from '@supabase/supabase-js';
import { ArrowRight, CalendarDays, LogOut, MapPin, ShieldCheck, Ticket } from 'lucide-react';
import { supabase } from '../lib/supabase';
import '../styles/app.css';
import { CreateEvent } from '../features/events/CreateEvent';
const EventDetails = lazy(() => import('../features/events/EventDetails').then(module => ({ default: module.EventDetails })));

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
        setMessage('El enlace no es válido o venció. Solicite una nueva invitación.');
      }
      if (token && (callbackType === 'invite' || callbackType === 'recovery')) {
        ({ error } = await client.auth.verifyOtp({ token_hash: token, type: callbackType }));
      } else if (code) ({ error } = await client.auth.exchangeCodeForSession(code));
      if (error) setMessage('El enlace no es válido o venció. Solicite una nueva invitación.');
      const { data, error: sessionError } = await client.auth.getSession();
      setSession(data.session);
      if (sessionError) setMessage('No se pudo recuperar la sesión. Intente ingresar nuevamente.');
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
      if (eventResult.error || orgResult.error || memberResult.error) setMessage('No se pudieron cargar todos los permisos y eventos. Intente recargar la página.');
      setEvents(eventResult.data || []);
      const roles = [...(orgResult.data || []), ...(memberResult.data || [])].map(m => m.role);
      setRole(roles.includes('owner') ? 'Propietario' : roles.includes('admin') ? 'Administrador' : roles.includes('supervisor') ? 'Supervisor' : roles.includes('scanner') ? 'Personal de puerta' : roles.includes('member') ? 'Miembro' : 'Sin asignación');
      setLoading(false);
    }).catch(() => { if (active) { setMessage('No se pudo conectar. Vuelva a intentar.'); setLoading(false); } });
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
        if (error) { setMessage('No se pudo guardar la contraseña. Revise los requisitos o solicite un nuevo enlace.'); return; }
        setPasswordSetup(false); window.history.replaceState({}, '', '/');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: String(data.get('email')).trim(), password: String(data.get('password')) });
        if (error) setMessage('No pudimos iniciar sesión. Revise su correo y contraseña.');
      }
    } catch { setMessage('No se pudo conectar. Revise su conexión e intente nuevamente.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    if (!supabase) return;
    setBusy(true);
    try { const { error } = await supabase.auth.signOut(); if (error) setMessage('No se pudo cerrar la sesión. Intente nuevamente.'); else { setPasswordSetup(false); setMessage(''); } }
    catch { setMessage('No se pudo cerrar la sesión. Revise su conexión.'); }
    finally { setBusy(false); }
  }

  const brand = <a className="brand" href="/" aria-label="Santos Rock Access, inicio"><img src="/logo_SR_blanco.png" alt="Santos Rock" width={114} height={62}/><span className="brand-access">Access</span></a>;
  const visibleEvents = events.filter(event =>
    (!statusFilter || event.status === statusFilter) &&
    `${event.name} ${event.venue || ''}`.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))
  ).sort((a, b) => (new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()) * (sort === 'asc' ? 1 : -1));
  return <div className="app"><a className="skip-link" href="#main-content">Ir al contenido</a>
    <header>{brand}{session && <button className="btn quiet" disabled={busy} onClick={logout}><LogOut size={16}/> Salir</button>}</header>
    {loading ? <main id="main-content" tabIndex={-1} className="loading" role="status">Cargando…</main> : session && !passwordSetup ? <main id="main-content" tabIndex={-1} className="dashboard">
      {detailId ? <Suspense fallback={<p role="status">Cargando evento…</p>}><EventDetails eventId={detailId} userId={session.user.id}/></Suspense> : <>

      <div className="dashboard-heading"><div><h1>Eventos</h1></div><span className="role"><ShieldCheck size={16}/>{role}</span></div>
      <div className="session"><span>Sesión de <strong>{session.user.email}</strong></span></div>
      <CreateEvent key={session.user.id} userId={session.user.id} onCreated={() => setRevision(value => value + 1)}/>
      {message && <p className="notice" role="alert">{message}</p>}
      <div className="event-filters"><label>Buscar evento<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nombre o lugar"/></label><label>Estado<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">Todos los estados</option>{Object.entries(statusNames).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label><label>Orden<select value={sort} onChange={e => setSort(e.target.value)}><option value="asc">Fecha ascendente</option><option value="desc">Fecha descendente</option></select></label></div>
      <p role="status">{visibleEvents.length} de {events.length} eventos</p>
      <section className="events" aria-label="Eventos disponibles">{visibleEvents.length ? visibleEvents.map(event => <article className="event" key={event.id}>
        <div className="event-art"><Ticket size={24}/><span className={`status-badge status-${event.status}`}>{statusNames[event.status] || event.status}</span></div>
        <div className="event-body"><h2><a href={`/events/${event.id}`}>{event.name}</a></h2><p><CalendarDays size={16}/>{new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', dateStyle: 'long', timeStyle: 'short' }).format(new Date(event.starts_at))}</p><p><MapPin size={16}/>{event.venue || 'Lugar por definir'}</p><a className="btn quiet detail-link" href={`/events/${event.id}`}>Abrir evento <ArrowRight size={16}/></a></div>
      </article>) : <div className="empty"><CalendarDays size={36}/><h2>{events.length ? 'No hay eventos con estos filtros' : 'Todavía no tiene eventos asignados'}</h2><p>{events.length ? 'Pruebe con otro nombre, lugar o estado.' : 'Pida al administrador que revise su acceso a la organización o al evento.'}</p>{events.length > 0 && <button className="btn quiet" onClick={() => { setSearch(''); setStatusFilter(''); }}>Limpiar filtros</button>}</div>}</section>

      </>}
    </main> : <main id="main-content" tabIndex={-1} className="auth-layout">
      <section className="intro"><div className="eyebrow"><span className="line"/> SANTOS ROCK ACCESS</div><h1>Todo listo.<br/><span>Puertas abiertas.</span></h1></section>
      <section className="auth-card"><div className="card-top"><ShieldCheck size={23}/></div><h2>{passwordSetup ? 'Crear contraseña' : 'Iniciar sesión'}</h2><p>{passwordSetup ? 'Use al menos 12 caracteres.' : 'Acceso para el equipo de Santos Rock.'}</p>
        {!supabase && <div className="notice">El acceso no está disponible. Contacte al administrador.</div>}
        {message && <div className="notice" role="alert">{message}</div>}
        {passwordSetup && !session ? <div className="notice">Necesita un enlace de invitación o recuperación válido. Solicite uno nuevo al administrador.</div> : <form onSubmit={submit}>
          {!passwordSetup && <label>Correo electrónico<input name="email" type="email" placeholder="correo@ejemplo.com" autoComplete="username" required disabled={!supabase}/></label>}
          <label>{passwordSetup ? 'Nueva contraseña' : 'Contraseña'}<input name="password" type="password" placeholder="Su contraseña" autoComplete={passwordSetup ? 'new-password' : 'current-password'} minLength={passwordSetup ? 12 : undefined} required disabled={!supabase}/></label>
          {passwordSetup && <><small>Use al menos 12 caracteres.</small><label>Confirme su contraseña<input name="confirm" type="password" autoComplete="new-password" minLength={12} required/></label></>}
          <button className="btn primary" disabled={!supabase || busy}>{busy ? 'Un momento…' : passwordSetup ? 'Guardar contraseña' : 'Ingresar'}<ArrowRight size={18}/></button>
        </form>}
        <div className="invitation"><span>¿Todavía no tiene acceso?</span><p>Solicite una invitación al administrador de Santos Rock.</p></div>
      </section>
    </main>}
    <footer><span>© {new Date().getFullYear()} SANTOS ROCK</span><a href="https://santosrock.com/" target="_blank" rel="noreferrer">santosrock.com ↗</a></footer>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
