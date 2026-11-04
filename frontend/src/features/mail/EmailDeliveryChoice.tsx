import { useMailAvailability, validMail, mailTiming } from './mailAvailability';

export function EmailDeliveryChoice({ recipients, checked, onChange, bulk = false, label }: {
  recipients: string[]; checked: boolean; onChange: (value: boolean) => void; bulk?: boolean; label?: string;
}) {
  const availability = useMailAvailability();
  const valid = recipients.length > 0 && recipients.every(validMail);
  return <div className="email-choice">
    <label className="saved-check"><input type="checkbox" checked={checked && valid} onChange={e => onChange(e.target.checked)} disabled={!valid || availability.checking || !availability.ready}/>{label || (bulk ? 'Enviar por correo al importar' : 'Enviar por correo al emitir')}</label>
    {!valid ? <small>Agregue un correo válido para habilitar esta opción.</small> : <>
      <p className="email-recipient">{recipients.length === 1 ? <>Para: <strong>{recipients[0]}</strong></> : `${recipients.length} entradas con correo.`}</p>
      {recipients.length > 1 && <details><summary>Ver destinatarios</summary><ul>{recipients.map((recipient, index) => <li key={index}>{recipient}</li>)}</ul></details>}
      {availability.checking ? <p role="status">Consultando correo…</p> : !availability.ready ? <><p>Correo no disponible. Puede emitir y guardar los QR.</p><button className="btn quiet" type="button" onClick={availability.reload}>Reintentar consulta de correo</button></> : <small>{availability.enabled ? mailTiming : 'Envíos pausados: si selecciona esta opción, los correos quedarán pendientes hasta su activación.'}</small>}
    </>}
  </div>;
}
