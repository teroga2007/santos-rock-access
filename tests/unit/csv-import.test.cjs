const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/features/tickets/csvImport.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const helper = { exports: {} };
new Function('module', 'exports', 'require', compiled)(helper, helper.exports, require);
const { parseTicketCsv } = helper.exports;

test('reads UTF-8 BOM, quoted names, semicolon delimiter and CRLF', () => {
  const result = parseTicketCsv('\uFEFFnombre;correo;referencia\r\n"María, José";persona@example.com;REF-1\r\n', 'sinpe');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows, [{ name: 'María, José', email: 'persona@example.com', reference: 'REF-1' }]);
});
test('SINPE references required, optional for complimentary', () => {
  const csv = 'nombre,correo,referencia\nPersona,,\n';
  assert.ok(parseTicketCsv(csv, 'sinpe').errors.length);
  assert.deepEqual(parseTicketCsv(csv, 'complimentary').errors, []);
});

test('priced imports require payment references even through other channels', () => {
  const csv = 'nombre,correo,referencia\nPersona,,\n';
  assert.deepEqual(parseTicketCsv(csv, 'other').errors, []);
  assert.ok(parseTicketCsv(csv, 'other', true).errors.length);
  assert.deepEqual(parseTicketCsv('nombre,correo,referencia\nPersona,,OTHER-1\n', 'other', true).errors, []);
});
test('rejects duplicate people with same email and payment, ignoring case and whitespace', () => {
  const csv = 'nombre,correo,referencia\n Persona ,PERSONA@example.com,REF-1\npersona,persona@example.com,REF-1\n';
  assert.ok(parseTicketCsv(csv, 'sinpe').errors.some(error => error.includes('repetidas')));
});
test('allows different people with the same payment reference', () => {
  const csv = 'nombre,correo,referencia\nPersona Uno,uno@example.com,REF-1\nPersona Dos,dos@example.com,REF-1\n';
  assert.deepEqual(parseTicketCsv(csv, 'sinpe').errors, []);
});
test('rejects invalid emails, missing headers, malformed rows, and empty files', () => {
  assert.ok(parseTicketCsv('nombre,correo,referencia\nPersona,no-es-correo,REF\n', 'sinpe').errors.length);
  assert.ok(parseTicketCsv('otro,correo\nPersona,a@example.com\n', 'other').errors.length);
  assert.ok(parseTicketCsv('nombre,correo\nPersona,a@example.com,columna-extra\n', 'other').errors.length);
  assert.ok(parseTicketCsv('nombre,correo,referencia\n', 'sinpe').errors.length);
});
test('blocks more than 100 rows', () => {
  const csv = 'nombre,correo,referencia\n' + Array.from({ length: 101 }, (_, i) => `Persona ${i},p${i}@example.com,REF-${i}`).join('\n');
  assert.ok(parseTicketCsv(csv, 'sinpe').errors.some(error => error.includes('100')));
});
test('download manifest prevents spreadsheet formula execution and survives ZIP roundtrip', () => {
  const Papa = require('papaparse');
  const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');
  const csv = Papa.unparse([{ nombre: '=2+2', archivo: '001.png' }], { escapeFormulae: true });
  const zip = zipSync({ 'personas.csv': strToU8(csv), '001.png': new Uint8Array([1, 2, 3]) });
  const files = unzipSync(zip);
  assert.deepEqual(Object.keys(files).sort(), ['001.png', 'personas.csv']);
  assert.ok(strFromU8(files['personas.csv']).includes("'=2+2"));
  assert.deepEqual(files['001.png'], new Uint8Array([1, 2, 3]));
});
