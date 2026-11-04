import Papa from 'papaparse';

export type ImportRow = { name: string; email: string; reference: string };
export function parseTicketCsv(text: string, source: string, requirePaymentReference = false): { rows: ImportRow[]; errors: string[] } {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: value => value.replace(/^\uFEFF/, '').trim().toLowerCase() });
  const errors: string[] = [];
  if (parsed.errors.length) errors.push('El CSV tiene columnas o comillas inconsistentes. Revisá su formato.');
  const headers = parsed.meta.fields || [];
  if (!headers.includes('nombre')) errors.push('Falta la columna obligatoria nombre.');
  if (headers.some(header => !['nombre', 'correo', 'referencia'].includes(header))) errors.push('La plantilla solo admite nombre, correo y referencia.');
  if (parsed.data.length < 1 || parsed.data.length > 100) errors.push('El archivo debe contener entre 1 y 100 filas de personas.');
  const seen = new Set<string>();
  const rows = parsed.data.slice(0, 100).map((record, index) => {
    const row = { name: (record.nombre || '').trim(), email: (record.correo || '').trim(), reference: (record.referencia || '').trim() };
    const line = index + 2;
    if (row.name.length < 2 || row.name.length > 160) errors.push(`Fila ${line}: el nombre debe tener entre 2 y 160 caracteres.`);
    if (row.email && (row.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))) errors.push(`Fila ${line}: correo no válido.`);
    if (row.reference.length > 160 || ((source === 'sinpe' || requirePaymentReference) && !row.reference)) errors.push(`Fila ${line}: revisá la referencia de pago (obligatoria para ventas pagadas, máximo 160 caracteres).`);
    const key = JSON.stringify([row.name.toLowerCase(), row.email.toLowerCase(), row.reference]);
    if (seen.has(key)) errors.push(`Fila ${line}: persona y referencia repetidas dentro del archivo.`);
    seen.add(key); return row;
  });
  return { rows, errors };
}
