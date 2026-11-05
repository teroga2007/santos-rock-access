import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { IScannerControls } from '@zxing/browser';
import { Camera, CameraOff, ScanLine } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type ScanResponse = { result: 'accepted' | 'duplicate' | 'invalid' | 'void' | 'wrong_event' | 'error'; reason?: string; type_name?: string; access_zone?: string; redeemed_at?: string };
type Request = { p_event_id: string; p_token: string; p_request_id: string };
const labels: Record<ScanResponse['result'], string> = { accepted: 'Ingreso autorizado', duplicate: 'Entrada ya utilizada', invalid: 'Código no válido', void: 'Entrada anulada', wrong_event: 'Entrada de otro evento', error: 'Evento sin ingreso habilitado' };

export function EventScanner({ eventId, eventStatus, onRedeemed, onPendingChange }: { eventId: string; eventStatus: string; onRedeemed: () => void; onPendingChange: (value: boolean) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const locked = useRef(false);
  const inFlight = useRef(false);
  const [camera, setCamera] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Request | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const live = eventStatus === 'live';

  function stop() {
    generation.current++;
    controls.current?.stop(); controls.current = null;
    const stream = video.current?.srcObject;
    if (typeof MediaStream !== 'undefined' && stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
    if (video.current) video.current.srcObject = null;
  }
  useEffect(() => {
    onPendingChange(!!pending);
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(); };
  }, []);
  useEffect(() => {
    if (!live) { stop(); setCamera(false); setStarting(false); }
  }, [live]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    if (pending) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);

  async function send(request: Request) {
    if (!supabase || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const { data, error } = await supabase.rpc('redeem_ticket', request);
      if (!mounted.current) return;
      if (error) {
        setError(error.code === '42501' ? 'No tiene acceso al control de ingreso de este evento.' : error.code === 'PGRST202' ? 'Falta habilitar el canje en la base de datos.' : error.code === '54000' ? 'Se alcanzó el límite de lecturas. Espere un minuto y reintente.' : 'No se pudo confirmar el resultado. Reintente la misma lectura. No autorice el ingreso sin confirmación.');
        return;
      }
      if (!data || typeof data.result !== 'string' || !(data.result in labels)) {
        setError('Respuesta inesperada. No autorice el ingreso; reintente la misma lectura.'); return;
      }
      setResult(data as ScanResponse); setPending(null); setManual('');
      if (data.result === 'accepted') { navigator.vibrate?.(100); onRedeemed(); }
    } catch { if (mounted.current) setError('Sin confirmación del servidor. No autorice el ingreso; reintente la misma lectura.'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  async function read(text: string) {
    if (locked.current || !live || !mounted.current) return;
    locked.current = true; setError('');
    const token = text.trim();
    if (!/^sra1_[A-Za-z0-9_-]{43}$/.test(token)) { setResult({ result: 'invalid' }); return; }
    try {
      const request = { p_event_id: eventId, p_token: token, p_request_id: crypto.randomUUID() };
      setPending(request); await send(request);
    } catch { setError('No se pudo preparar la lectura. Vuelva a intentar.'); locked.current = false; }
  }

  async function start() {
    if (starting || camera || !live) return;
    setStarting(true); setError('');
    const current = ++generation.current;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('camera');
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      if (!mounted.current || current !== generation.current || !video.current) return;
      const reader = new BrowserQRCodeReader();
      const scanner = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video.current, decoded => {
        if (decoded && generation.current === current) void read(decoded.getText());
      });
      if (!mounted.current || current !== generation.current) { scanner.stop(); return; }
      controls.current = scanner; setCamera(true);
    } catch { if (mounted.current && current === generation.current) { stop(); setError('No se pudo abrir la cámara. Revise sus permisos o cargue una imagen del QR.'); } }
    finally { if (mounted.current) setStarting(false); }
  }

  async function image(file: File) {
    if (locked.current || !live) return;
    locked.current = true; setBusy(true); setError('');
    const url = URL.createObjectURL(file);
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const decoded = await new BrowserQRCodeReader().decodeFromImageUrl(url);
      if (!mounted.current) return;
      locked.current = false; await read(decoded.getText());
    } catch { if (mounted.current) { setError('No se encontró un QR legible en esa imagen.'); locked.current = false; } }
    finally { URL.revokeObjectURL(url); if (mounted.current) setBusy(false); }
  }

  function manualSubmit(e: FormEvent) { e.preventDefault(); void read(manual); }
  return <section className="details-panel scanner-panel" aria-label="Control de ingreso"><h2><ScanLine size={23}/> Control de ingreso</h2>
    <p>Una lectura válida registra el ingreso.</p>
    {!live && <p className="notice">{eventStatus === 'closed' || eventStatus === 'cancelled' ? 'Este evento ya no admite ingresos.' : 'El ingreso aún no está habilitado. Solicite al administrador que lo inicie.'}</p>}
    <div className="scanner-workspace"><div>
    <div className="camera-box"><video ref={video} autoPlay muted playsInline aria-label="Cámara del escáner"/>{!camera && !starting && <span>Cámara apagada</span>}</div>
    <div className="scanner-actions"><button className="btn primary" disabled={!live || starting || camera} onClick={start}><Camera size={17}/>{starting ? 'Abriendo cámara…' : 'Activar cámara'}</button><button className="btn quiet" disabled={!camera && !starting} onClick={() => { stop(); setCamera(false); setStarting(false); }}><CameraOff size={17}/> Apagar cámara</button></div>
    </div><div className="scanner-feedback" aria-label="Resultado de lectura">
    {!busy && !result && !error && <div className="scan-idle"><ScanLine size={32}/><h3>{live ? 'Listo para leer' : 'Ingreso deshabilitado'}</h3><p>{live ? 'El resultado aparecerá aquí.' : 'No se pueden validar entradas.'}</p></div>}
    {busy && <p role="status">Confirmando lectura…</p>}
    {error && <p role="alert" className="notice">{error}</p>}
    {pending && !busy && <button className="btn quiet" onClick={() => send(pending)}>Reintentar la misma lectura</button>}
    {result && <div className={`scan-result scan-${result.result}`} role="status" aria-live="polite"><h3>{labels[result.result]}</h3>{result.type_name && <p>{result.type_name} · Zona: {result.access_zone}</p>}{result.redeemed_at && <p>Ingreso registrado: {new Intl.DateTimeFormat('es-CR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Costa_Rica' }).format(new Date(result.redeemed_at))}</p>}<button className="btn quiet" onClick={() => { setResult(null); setError(''); locked.current = false; }}>Siguiente lectura</button></div>}
    </div></div>
    <details className="type-setup scan-alternatives"><summary>Cargar imagen o ingresar código</summary><fieldset className="scan-fallback" disabled={!live || busy || !!pending || !!result}><label>Imagen del QR<input type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void image(file); }}/></label><form onSubmit={manualSubmit}><p>Copie el código completo que aparece en el correo, incluido el prefijo sra1_.</p><label>Código de la entrada<input value={manual} onChange={e => setManual(e.target.value)} autoComplete="off" spellCheck={false} maxLength={512} placeholder="sra1_…" required/></label><button className="btn quiet" disabled={!manual.trim()}>Registrar ingreso</button></form></fieldset></details>
  </section>;
}
