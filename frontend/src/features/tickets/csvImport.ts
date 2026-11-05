import Papa from 'papaparse';

export type ImportRow = { name: string; email: string; quantity: number };
export function parseTicketCsv(text: string): { rows: ImportRow[]; errors: string[] } {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: value => value.replace(/^\uFEFF/, '').trim().toLowerCase() });
  const errors: string[] = [];
  if (parsed.errors.length) errors.push('El CSV tiene columnas o comillas inconsistentes. Revise su formato.');
  const headers = parsed.meta.fields || [];
  for (const header of ['nombre', 'correo', 'cantidad']) if (!headers.includes(header)) errors.push('Falta la columna ' + header + '.');
  if (headers.some(header => !['nombre', 'correo', 'cantidad'].includes(header))) errors.push('La plantilla admite nombre, correo y cantidad. Descargue la plantilla actualizada.');
  if (parsed.data.length < 1 || parsed.data.length > 100) errors.push('El archivo debe contener entre 1 y 100 compradores.');
  const seen = new Set<string>();
  const rows = parsed.data.slice(0, 100).map((record, index) => {
    const quantity = (record.cantidad || '').trim();
    const row = { name: (record.nombre || '').trim(), email: (record.correo || '').trim().toLowerCase(), quantity: /^[1-9][0-9]{0,2}$/.test(quantity) ? Number(quantity) : 0 };
    const line = index + 2;
    if (row.name.length < 2 || row.name.length > 160) errors.push(`Fila ${line}: el nombre debe tener entre 2 y 160 caracteres.`);
    if (row.email && (row.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))) errors.push(`Fila ${line}: correo no válido.`);
    if (row.quantity < 1 || row.quantity > 100) errors.push(`Fila ${line}: la cantidad debe ser un entero entre 1 y 100.`);
    const key = JSON.stringify([row.name.toLowerCase(), row.email]);
    if (seen.has(key)) errors.push(`Fila ${line}: comprador repetido. Unifique sus entradas en cantidad.`);
    seen.add(key); return row;
  });
  if (rows.reduce((sum, row) => sum + row.quantity, 0) > 100) errors.push('El archivo admite hasta 100 entradas en total. Divida cantidades mayores en otros lotes.');
  return { rows, errors };
}
