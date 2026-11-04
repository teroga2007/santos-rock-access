import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Banknote, CalendarDays, ChartNoAxesCombined, LayoutDashboard, MapPin, RefreshCw, ScanLine, Ticket, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { EventTeam } from '../team/EventTeam';
import { EventTickets } from '../tickets/EventTickets';
import { EventStatus } from './EventStatus';
import { DeleteTestEvent } from './DeleteTestEvent';
import { eventAccess, type EventSection } from '../../lib/eventAccess';
const EventDashboard = lazy(() => import('../access/EventDashboard').then(module => ({ default: module.EventDashboard })));
const EventScanner = lazy(() => import('../access/EventScanner').then(module => ({ default: module.EventScanner })));
const EventFinances = lazy(() => import('../finance/EventFinances').then(module => ({ default: module.EventFinances })));
const DoorSales = lazy(() => import('../tickets/DoorSales').then(module => ({ default: module.DoorSales })));
type Details = { id: string; organization_id: string; name: string; venue: string | null; starts_at: string; ends_at: string | null; timezone: string; status: string };
const statuses: Record<string, string> = { draft: 'Borrador', published: 'Publicado', live: 'En vivo', closed: 'Finalizado', cancelled: 'Cancelado' };
function date(value: string, timezone: string) {
  try { return new Intl.DateTimeFormat('es-CR', { timeZone: timezone, dateStyle: 'long', timeStyle: 'short' }).format(new Date(value)); }
  catch { return 'Fecha no disponible'; }
}
const sections = [
  { id: 'overview' as const, label: 'Resumen', icon: LayoutDashboard },
  { id: 'entry' as const, label: 'Ingreso', icon: ScanLine },
  { id: 'door' as const, label: 'Venta en puerta', icon: Banknote },
  { id: 'tickets' as const, label: 'Entradas', icon: Ticket },
  { id: 'finances' as const, label: 'Finanzas', icon: ChartNoAxesCombined },
  { id: 'team' as const, label: 'Equipo', icon: Users },
];
export function EventDetails({ eventId, userId }: { eventId: string; userId: string }) {
  const [event, setEvent] = useState<Details | null>(null);
  const [organization, setOrganization] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [ticketRevision, setTicketRevision] = useState(0);
  const [scanPending, setScanPending] = useState(false);
  const [ticketPending, setTicketPending] = useState(false);
  const [statusPending, setStatusPending] = useState(false);
  const [teamPending, setTeamPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [doorPending, setDoorPending] = useState(false);
  const [doorVisited, setDoorVisited] = useState(false);
  const [access, setAccess] = useState<ReturnType<typeof eventAccess> | null>(null);
  const [section, setSection] = useState<EventSection>('overview');
  const [ticketsVisited, setTicketsVisited] = useState(false);
  const [teamVisited, setTeamVisited] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const navigationBlocked = scanPending || ticketPending || statusPending || teamPending || deletePending || doorPending;
  function navigate(next: EventSection) {
    if (navigationBlocked || !access?.sections.includes(next)) return;
    if (next === 'tickets') setTicketsVisited(true);
    if (next === 'team') setTeamVisited(true);
    if (next === 'door') setDoorVisited(true);
    setSection(next);
  }
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    setLoading(true); setError(''); setEvent(null); setOrganization(''); setAccess(null); setTicketsVisited(false);
    async function load() {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
        if (active) { setLoading(false); setError('El enlace del evento no es válido.'); } return;
      }
      const result = await client.from('events').select('id,organization_id,name,venue,starts_at,ends_at,timezone,status').eq('id', eventId).maybeSingle();
      if (!active) return;
      if (result.error) { setError('No se pudo cargar el evento. Revise su conexión y vuelva a intentar.'); setLoading(false); return; }
      if (!result.data) { setError('El evento no existe o su cuenta no tiene acceso.'); setLoading(false); return; }
      const [org, orgRoles, eventRoles] = await Promise.all([
        client.from('organizations').select('name').eq('id', result.data.organization_id).maybeSingle(),
        client.from('organization_members').select('role').eq('organization_id', result.data.organization_id).eq('user_id', userId),
        client.from('event_members').select('role').eq('event_id', eventId).eq('user_id', userId),
      ]);
      if (!active) return;
      if (orgRoles.error || eventRoles.error) { setError('No se pudieron verificar sus permisos. Vuelva a intentar.'); setLoading(false); return; }
      const permissions = eventAccess((orgRoles.data || []).map(m => m.role), (eventRoles.data || []).map(m => m.role));
      setAccess(permissions); setSection(permissions.defaultSection);
      setEvent(result.data); setOrganization(org.data?.name || ''); setLoading(false);
    }
    load().catch(() => { if (active) { setError('No se pudo conectar para cargar el evento.'); setLoading(false); } });
    return () => { active = false; };
  }, [eventId, userId, revision]);
  useEffect(() => { if (!loading) heading.current?.focus(); }, [loading]);
  return <div className="event-details">
    <a className="btn quiet back-link" href="/" onClick={e => { if (navigationBlocked) e.preventDefault(); }} aria-disabled={navigationBlocked}><ArrowLeft size={16}/> Eventos</a>
    {loading ? <p role="status">Cargando evento…</p> : error ? <section className="empty"><h1 ref={heading} tabIndex={-1}>Evento no disponible</h1><p role="alert">{error}</p><button className="btn quiet" onClick={() => setRevision(value => value + 1)}><RefreshCw size={16}/> Reintentar</button></section> : event && access && <>
      <div className="eyebrow">{organization || 'Santos Rock'}</div>
      <div className="dashboard-heading"><h1 ref={heading} tabIndex={-1}>{event.name}</h1><span className={'status-badge status-' + event.status}>{statuses[event.status] || event.status}</span></div>
      <div className="event-meta"><span><CalendarDays size={16}/>{date(event.starts_at, event.timezone)}</span><span><MapPin size={16}/>{event.venue || 'Lugar por definir'}</span><span className="role">{access.label}</span></div>
      <nav className="event-nav" aria-label="Secciones del evento">{sections.filter(item => access.sections.includes(item.id)).map(item => <button key={item.id} type="button" aria-current={section === item.id ? 'page' : undefined} aria-controls={'section-' + item.id} disabled={navigationBlocked && section !== item.id} onClick={() => navigate(item.id)}><item.icon size={18}/>{item.label}</button>)}</nav>
      {navigationBlocked && <p className="notice" role="status">{deletePending ? 'Eliminando el evento de prueba…' : ticketPending || doorPending ? 'Complete la operación pendiente y guarde los QR antes de salir de esta sección.' : scanPending ? 'Espere la confirmación de la lectura antes de continuar.' : teamPending ? 'Guardando los cambios del equipo…' : 'Confirme o cancele el cambio de estado para continuar.'}</p>}
      <div id="section-overview" hidden={section !== 'overview'}>{section === 'overview' && <>
        {access.admin && <EventStatus eventId={event.id} organizationId={event.organization_id} userId={userId} status={event.status} blocked={scanPending || ticketPending} onPendingChange={setStatusPending} onChanged={status => setEvent(value => value ? { ...value, status } : value)}/>}
        <div className="quick-actions">
          {access.scanner && <button className="quick-action" disabled={navigationBlocked} onClick={() => navigate('entry')}><ScanLine size={24}/><span><strong>Control de ingreso</strong><small>{event.status === 'live' ? 'Escanear una entrada' : 'Consultar el ingreso'}</small></span><ArrowRight size={18}/></button>}
          {access.admin && <button className="quick-action" disabled={navigationBlocked} onClick={() => navigate('door')}><Banknote size={24}/><span><strong>Venta en puerta</strong><small>Registrar pago y emitir una entrada</small></span><ArrowRight size={18}/></button>}
          {access.supervisor && <button className="quick-action" disabled={navigationBlocked} onClick={() => navigate('tickets')}><Ticket size={24}/><span><strong>Entradas</strong><small>{access.admin ? 'Emitir y administrar' : 'Consultar entradas'}</small></span><ArrowRight size={18}/></button>}
          {access.finances && <button className="quick-action" disabled={navigationBlocked} onClick={() => navigate('finances')}><ChartNoAxesCombined size={24}/><span><strong>Finanzas</strong><small>Ingresos y totales por tipo</small></span><ArrowRight size={18}/></button>}
        </div>
        {access.supervisor && <Suspense fallback={<p role="status">Cargando resumen…</p>}><EventDashboard eventId={event.id} userId={userId} refreshKey={ticketRevision + ':' + event.status}/></Suspense>}
        <section className="details-panel" aria-label="Información del evento"><h2>Información del evento</h2><dl className="details-grid"><div><dt>Inicio</dt><dd>{date(event.starts_at, event.timezone)}</dd></div><div><dt>Cierre</dt><dd>{event.ends_at ? date(event.ends_at, event.timezone) : 'Sin definir'}</dd></div><div><dt>Zona horaria</dt><dd>{event.timezone === 'America/Costa_Rica' ? 'Costa Rica (UTC−6)' : event.timezone}</dd></div></dl></section>
      </>}</div>
      <div id="section-entry" hidden={section !== 'entry'}>{section === 'entry' && access.scanner && <Suspense fallback={<p role="status">Cargando ingreso…</p>}><EventScanner eventId={event.id} eventStatus={event.status} onRedeemed={() => setTicketRevision(v => v + 1)} onPendingChange={setScanPending}/></Suspense>}</div>
      <div id="section-tickets" hidden={section !== 'tickets'}>{ticketsVisited && access.supervisor && <EventTickets eventId={event.id} organizationId={event.organization_id} userId={userId} eventStatus={event.status} refreshKey={ticketRevision} onPendingChange={setTicketPending} onChanged={() => setTicketRevision(v => v + 1)}/>}</div>
      <div id="section-door" hidden={section !== 'door'}>{doorVisited && access.admin && <Suspense fallback={<p role="status">Cargando venta en puerta…</p>}><DoorSales eventId={event.id} eventStatus={event.status} onPendingChange={setDoorPending} onChanged={() => setTicketRevision(value => value + 1)}/></Suspense>}</div>
      <div id="section-finances" hidden={section !== 'finances'}>{section === 'finances' && access.finances && <Suspense fallback={<p role="status">Cargando finanzas…</p>}><EventFinances eventId={event.id}/></Suspense>}</div>
      <div id="section-team" hidden={section !== 'team'}>{teamVisited && access.organizationAdmin && <section className="details-panel"><h2>Equipo del evento</h2><EventTeam eventId={event.id} organizationId={event.organization_id} userId={userId} expanded onPendingChange={setTeamPending}/></section>}</div>
      {section === 'overview' && access.owner && <DeleteTestEvent eventId={event.id} eventName={event.name} blocked={scanPending || ticketPending || statusPending || teamPending} onPendingChange={setDeletePending}/>}
    </>}
  </div>;
}
