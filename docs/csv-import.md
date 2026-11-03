# Importación CSV — fase 010

Migración 010 aplicada a `santos-rock-access` el 3 de noviembre de 2026, tras preflight transaccional y dry-run. La suite SQL pasó después de la aplicación, incluido lote máximo de 100 entradas y rechazo de 101; todos los datos de prueba se revirtieron.

En Entradas y acreditaciones → Importar compradores desde CSV. Solo administradores efectivos del evento pueden importar; supervisores y scanners no reciben esta opción y la RPC los rechaza.

## Preparar el archivo

Descargar la plantilla desde la aplicación. Guardar como CSV UTF-8, máximo 1 MB, entre 1 y 100 personas por lote. Admite coma o punto y coma como separador y nombres entre comillas.

```csv
nombre,correo,referencia
Persona Uno,uno@example.com,REF-001
Persona Dos,dos@example.com,REF-001
```

- Cada fila emite un acceso individual, no una compra de varias entradas. No hay columna cantidad.
- nombre: obligatorio, 2–160 caracteres.
- correo: opcional, máximo 254 caracteres y formato válido si se proporciona.
- referencia: obligatoria para SINPE, máximo 160 caracteres. Distintas personas pueden compartir referencia si pertenecen al mismo pago.
- Solo se admiten esas tres columnas. No se importan QR externos, códigos de LaTiqueteraCR ni contraseñas.
- Se elige un solo tipo y origen (SINPE, cortesía/acreditación u otro) para todo el lote. Crear el tipo antes de importar.
- Se muestra la vista previa completa de hasta 100 filas y los primeros 20 errores. No se permite confirmar hasta corregirlos. Revisar pagos manualmente: la aplicación no consulta bancos.

## Importar y entregar

1. Revisar vista previa, tipo y origen.
2. Confirmar que cada fila es una persona distinta y, para SINPE, que se verificaron todos los pagos.
3. Importar y esperar confirmación del servidor. Antes de enviar la solicitud se preparan todos los PNG y el ZIP en el navegador.
4. Descargar el ZIP y marcar que fue guardado antes de comenzar otro lote o cerrar el evento.
5. El ZIP contiene 001.png, 002.png, etc. y personas.csv con fila, nombre, correo, referencia, nombre de archivo, lote, evento, tipo y origen. Los nombres del CSV nunca se usan como rutas de archivos. Las fórmulas de hoja de cálculo se escapan en el manifiesto.

El ZIP contiene credenciales de ingreso y datos de titulares: usarlo para la entrega individual a cada persona, sin compartir el archivo completo con asistentes. No se envían correos en esta fase. Cada PNG funciona con el escáner existente.

## Atomicidad y duplicados

`import_native_tickets` guarda lote, entradas, titulares, órdenes SINPE, credenciales y auditoría en una transacción. Si una fila no es válida, el tipo no pertenece al evento, falta cupo o el evento está cerrado/cancelado, se revierte todo. No quedan lotes parciales. Cada entrada queda vinculada a import_batches y conserva las operaciones normales de canje/anulación/reemisión.

El batch_id identifica los reintentos; actor y todos los parámetros deben coincidir para devolver los mismos IDs. La respuesta no contiene tokens.

Una huella del contenido detecta el mismo lote aunque se cambie el orden o se generen QR nuevos. Huellas por fila rechazan además archivos parcialmente repetidos: se comparan nombre y correo sin distinción de mayúsculas y referencia, dentro del mismo evento, tipo y origen. Si una sola fila coincide con una importación previa, se rechaza el lote entero y se debe revisar el archivo. No hay omisión automática de filas ni informe de coincidencias del servidor en esta fase.

La detección no compara con entradas emitidas manualmente ni cruza tipos/orígenes diferentes. Personas distintas con exactamente los mismos nombre, correo y referencia requieren revisión y emisión individual deliberada; no modificar referencias bancarias reales para eludir la validación.

Los tokens originales y los archivos viven solo en la memoria del navegador y el ZIP descargado. La base guarda huellas, no PNG ni QR recuperables. Si se cierra el navegador después de confirmar y se pierde el ZIP, revisar el listado y reemitir los QR perdidos individualmente; no volver a importar el mismo archivo. Si la red falla, mantener la pantalla y reintentar el mismo lote.

## Verificación

- `npm run test:csv`: 7 pruebas correctas (BOM UTF-8, separadores, comillas, SINPE, duplicados, nombres distintos con mismo pago, datos inválidos, límite de 100 y escape de fórmulas/ZIP).
- `npm run build`: correcto, importador y generadores cargados bajo demanda.
- SQL: `ticket_redemption.sql` sin rollback final + `native_import_assertions.sql` + rollback. Antes de aplicar la migración se ejecutó además 010 en esa transacción. Comprueba capacidad insuficiente sin efectos parciales, lote de 2 personas con mismo pago, reintento idéntico, parámetros cambiados, archivo repetido/reordenado y parcialmente coincidente, referencia faltante, correo inválido, fuente externa rechazada, tipo de otro evento, supervisor sin permisos, asociación del lote, órdenes verificadas y auditoría única.
- Pendiente revisión en navegador, descarga real del ZIP, escaneo de sus PNG y pruebas concurrentes. No se importaron compradores reales desde el agente.
