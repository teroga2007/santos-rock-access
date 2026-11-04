# Precios de entradas y transporte

La migración `202611030012_ticket_prices.sql` agrega tarifas por evento y líneas de venta con importes históricos en CRC. Se aplicó al proyecto vinculado después de validar sus cambios en una transacción con rollback.

## Uso

En el evento, abrir **Entradas → Tipos de entrada → Agregar tarifas Santos Rock**. La acción agrega los tipos faltantes y conserva los existentes:

| Tipo | Concierto | Transporte | Total |
| --- | ---: | ---: | ---: |
| Fase 1 | ₡10.000 | ₡0 | ₡10.000 |
| Fase 2 | ₡13.500 | ₡0 | ₡13.500 |
| Día del evento / puerta | ₡16.000 | ₡0 | ₡16.000 |
| Fase 1 + transporte | ₡10.000 | ₡7.500 | ₡17.500 |
| Cortesías | ₡0 | ₡0 | ₡0 |
| Prensa | ₡0 | ₡0 | ₡0 |
| Staff | ₡0 | ₡0 | ₡0 |

**Editar** permite cambiar tarifas para futuras ventas y crear otras combinaciones, por ejemplo Fase 2 + transporte. El cupo sigue siendo por tipo, como antes. Esta opción no configura automáticamente un aforo global del evento.

En **Emitir entrada**, la selección muestra concierto, transporte y total. Una entrada con transporte genera un único QR de acceso al concierto. El transporte no genera un segundo acceso ni un segundo canje. No incluye control de abordaje del bus.

Las ventas pagadas requieren referencia y confirmación del pago. Para tipos gratuitos se puede usar el origen Cortesía / acreditación. CSV utiliza el mismo tipo y desglose para todas las personas del lote, muestra el total y exige referencias para ventas pagadas, incluso con origen Otro.

## Registro financiero

### Eliminar tipos sin uso

En **Entradas → Tipos de entrada**, cada tipo tiene **Eliminar**, junto a Editar. Se solicita confirmación y la lista se actualiza al terminar. Usa los mismos permisos administrativos que la edición de tarifas; supervisores no pueden eliminar tipos.

La migración 016 agrega `delete_ticket_type`: comprueba permisos, evento abierto y nombre actual. Bloquea el evento y el tipo durante la comprobación para evitar emisiones simultáneas. Solo elimina tipos sin entradas ni importaciones; también conserva el tipo si todas sus entradas están anuladas. Registra la eliminación en auditoría y permite reintentar sin duplicarla. Los tipos del evento se conservan hasta que el usuario elige explícitamente uno y confirma.

Validación: SQL con fixtures y rollback para permisos, límites entre eventos, nombre, historial, entradas anuladas, reintentos y auditoría; dos recorridos nuevos de interfaz para confirmación y bloqueo por historial, además de edición y continuidad de formularios; compilación correcta. El frontend requiere publicación en Netlify.

- `ticket_types.price_crc`, `transport_price_crc` y `category` configuran tarifas vigentes; un precio nulo significa **sin información**, no gratuito.
- `orders` sigue registrando origen, referencia y estado del pago.
- `order_items` conserva una línea de concierto o acreditación y, cuando corresponde, otra de transporte. Moneda CRC, cantidad uno por concepto y entrada, precio al emitir y descripción del tipo en ese momento.
- La cantidad de líneas `transport` permite contar compras con transporte. No debe sumarse como cantidad de entradas al concierto.
- Un trigger transaccional comparte el registro entre emisión y CSV. Reintentos y reemisiones no agregan otra venta.
- Las nuevas RPC `issue_priced_ticket` e `import_priced_native_tickets` comprueban la tarifa mostrada antes de una primera emisión. Una tarifa cambiada exige actualizar y verificar de nuevo el pago. Los reintentos de solicitudes ya confirmadas devuelven el resultado original.
- Las entradas existentes no se recalculan ni se rellenan con precios actuales. Los tipos antiguos conservan precio nulo hasta configurarlos; sus nuevas emisiones sin precio se advierten en la UI y tampoco inventan importes.
- Las acreditaciones tienen precio cero; no constituyen ventas pagadas.
- Anular un QR no registra una devolución de dinero. Los importes guardados representan la venta original; un futuro dashboard deberá considerar estados de pago y devoluciones expresas.
- Los datos monetarios no se toman de nombres de tipos ni del número de entradas. Para entradas de La Tiquetera se necesitará el importe del proveedor; el trigger evita inventarlo con tarifas locales.
- Lectura de líneas financieras reservada mediante RLS a propietarios de la organización y supervisores asignados al evento. Los usuarios autenticados no pueden escribirlas directamente. Administrar tarifas sigue usando los permisos administrativos existentes.

## Validación del incremento

- `supabase/tests/ticket_prices.sql`: tarifas iniciales sin duplicados, desglose 10.000 + 7.500, precios históricos, reintentos, referencias, acreditaciones, origen Otro, importación de paquetes, reemisión, tarifas desactualizadas y permisos. Fixtures con rollback, sin enviar correos.
- Dos nuevos recorridos de navegador para tarifas y venta combinada, junto con los recorridos existentes afectados por el cambio de RPC.
- Una prueba nueva de CSV para referencias de pago en otros canales.
- Compilación TypeScript/Vite correcta.

El frontend está preparado en el checkout local. Este incremento no incluye el dashboard financiero, la API de La Tiquetera ni la publicación del frontend en Netlify.
