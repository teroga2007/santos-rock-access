import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, MapPin, RefreshCw } from 'lucide-react';
import { supabase } from './client';
import { EventTeam } from './EventTeam';
import { EventTickets } from './EventTickets';
import { EventStatus } from './EventStatus';
const EventDashboard = lazy(() => import('./EventDashboard').then(module => ({ default: module.EventDashboard })));
const EventScanner = lazy(() => import('./EventScanner').then(module => ({ default: module.EventScanner })));

type Details = {
  id: string; organization_id: string; name: string; venue: string | null;
  starts_at: string; ends_at: string | null; timezone: string; status: string; created_at: string;
};
const statuses: Record<string, string> = { draft: 'Borrador', published: 'Publicado', live: 'En vivo', closed: 'Finalizado', cancelled: 'Cancelado' };
function date(value: string, timezone: string) {
  try { return new Intl.DateTimeFormat('es-CR', { timeZone: timezone, dateStyle: 'long', timeStyle: 'short' }).format(new Date(value)); }
  catch { return 'Fecha no disponible'; }
}

export function EventDetails({ eventId, userId }: { eventId: string; userId: string }) {
  const [event, setEvent] = useState<Details | null>(null);
  const [organization, setOrganization] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [ticketRevision, setTicketRevision] = useState(0);
  const [scanPending, setScanPending] = useState(false);
  const [ticketPending, setTicketPending] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    setLoading(true); setError(''); setEvent(null); setOrganization('');
    async function load() {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
        if (active) { setLoading(false); setError('El identificador del evento no es válido.'); } return;
      }
      const result = await client.from('events').select('id,organization_id,name,venue,starts_at,ends_at,timezone,status,created_at').eq('id', eventId).maybeSingle();
      if (!active) return;
      if (result.error) { setError('No se pudo cargar el evento. Revisá tu conexión e intentá nuevamente.'); setLoading(false); return; }
      if (!result.data) { setError('El evento no existe o tu cuenta no tiene acceso.'); setLoading(false); return; }
      setEvent(result.data);
      const org = await client.from('organizations').select('name').eq('id', result.data.organization_id).maybeSingle();
      if (active) { setOrganization(org.data?.name || ''); setLoading(false); }
    }
    load().catch(() => { if (active) { setError('No se pudo conectar para cargar el evento.'); setLoading(false); } });
    return () => { active = false; };
  }, [eventId, userId, revision]);

  useEffect(() => { if (!loading) heading.current?.focus(); }, [loading]);
  return <div className="event-details">
    <a className="quiet back-link" href="/"><ArrowLeft size={16}/> Volver a eventos</a>
    {loading ? <p role="status">Cargando evento…</p> : error ? <section className="empty"><h1 ref={heading} tabIndex={-1}>Evento no disponible</h1><p role="alert">{error}</p><button className="quiet" onClick={() => setRevision(value => value + 1)}><RefreshCw size={16}/> Reintentar</button></section> : event && <>
      <div className="eyebrow">{organization || 'DETALLE DEL EVENTO'}</div>
      <div className="dashboard-heading"><h1 ref={heading} tabIndex={-1}>{event.name}<span>.</span></h1><span className="role">{statuses[event.status] || event.status}</span></div>
      <p><MapPin size={17}/>{event.venue || 'Lugar por definir'}</p>
      <EventStatus eventId={event.id} organizationId={event.organization_id} userId={userId} status={event.status} blocked={scanPending || ticketPending} onChanged={status => setEvent(value => value ? { ...value, status } : value)}/>
      <Suspense fallback={<p role="status">Cargando panel de control…</p>}><EventDashboard eventId={event.id} userId={userId} refreshKey={`${ticketRevision}:${event.status}`}/></Suspense>
      <Suspense fallback={<p role="status">Cargando control de ingreso…</p>}><EventScanner eventId={event.id} eventStatus={event.status} onRedeemed={() => setTicketRevision(v => v + 1)} onPendingChange={setScanPending}/></Suspense>
      <section className="details-panel" aria-label="Información del evento"><h2>Información general</h2><dl className="details-grid">
        <div><dt><CalendarDays size={16}/> Inicio</dt><dd>{date(event.starts_at, event.timezone)}</dd></div>
        <div><dt>Cierre</dt><dd>{event.ends_at ? date(event.ends_at, event.timezone) : 'Sin hora de cierre definida'}</dd></div>
        <div><dt>Zona horaria</dt><dd>{event.timezone}</dd></div>
        <div><dt>Creado</dt><dd>{date(event.created_at, 'America/Costa_Rica')} (Costa Rica)</dd></div>
        <div className="event-reference"><dt>Identificador del evento</dt><dd>{event.id}</dd></div>
      </dl></section>
      <section className="details-panel" aria-label="Personal y permisos"><h2>Personal y permisos</h2><p>El acceso a este evento depende de tu membresía y del rol asignado.</p><EventTeam eventId={event.id} organizationId={event.organization_id} userId={userId}/></section>
      <EventTickets eventId={event.id} organizationId={event.organization_id} userId={userId} eventStatus={event.status} refreshKey={ticketRevision} onPendingChange={setTicketPending} onChanged={() => setTicketRevision(v => v + 1)}/>
    </>}
  </div>;
}
