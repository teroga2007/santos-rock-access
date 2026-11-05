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

test('reads UTF-8 BOM, quoted names, semicolon delimiter, quantities and CRLF', () => {
  const result = parseTicketCsv('\uFEFFnombre;correo;cantidad\r\n"María, José";PERSONA@example.com;3\r\n');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows, [{ name: 'María, José', email: 'persona@example.com', quantity: 3 }]);
});
test('does not require a payment reference, and supports offline delivery without email', () => {
  assert.deepEqual(parseTicketCsv('nombre,correo,cantidad\nPersona,,2\n').errors, []);
});
test('rejects missing, zero, negative, decimal, scientific and oversized quantities', () => {
  for (const qty of ['', '0', '-1', '1.5', '1e2', '101', 'NaN']) assert.ok(parseTicketCsv('nombre,correo,cantidad\nPersona,persona@example.com,' + qty).errors.length);
});
test('rejects duplicate buyer rows but allows different companions with the same email', () => {
  assert.ok(parseTicketCsv('nombre,correo,cantidad\nPersona,PERSONA@example.com,2\n persona ,persona@example.com,3').errors.some(error => error.includes('repetido')));
  assert.deepEqual(parseTicketCsv('nombre,correo,cantidad\nUno,persona@example.com,2\nDos,persona@example.com,3').errors, []);
});
test('requires the new template, valid email and well-formed CSV', () => {
  for (const text of ['nombre,correo,referencia\nPersona,a@example.com,REF', 'nombre,correo,cantidad\nPersona,bad,2', 'nombre,correo,cantidad\nPersona,a@example.com,2,extra', 'nombre,correo,cantidad\n']) assert.ok(parseTicketCsv(text).errors.length);
});
test('limits expanded tickets to 100, not just CSV rows', () => {
  assert.deepEqual(parseTicketCsv('nombre,correo,cantidad\nPersona,a@example.com,100').errors, []);
  assert.ok(parseTicketCsv('nombre,correo,cantidad\nUno,a@example.com,60\nDos,b@example.com,41').errors.some(error => error.includes('100')));
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
