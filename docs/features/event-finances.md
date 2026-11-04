# Finanzas por evento

Acceso desde **Evento → Finanzas** o desde el acceso directo del resumen. Disponible para propietarios de la organización y supervisores asignados al evento. El administrador sin esos roles y el personal de puerta no tienen acceso financiero. La RPC valida este permiso en Supabase, además de la navegación de la UI.

## Lectura del panel

- Total bruto, ingresos del concierto, ingresos de transporte y entradas vendidas.
- Cantidad de compras con transporte, accesos gratuitos emitidos y estados de uso de las entradas.
- Gráfico de ingresos del concierto por tipo, tabla por origen y detalle por tipo, concepto, precio histórico y estado de pago.
- Filtros de fecha de emisión en hora de Costa Rica, tipo y origen; se aplican explícitamente. El CSV exporta el detalle correspondiente al resultado consultado y se deshabilita mientras hay filtros sin aplicar.
- Los importes provienen de `order_items`, registrados al emitir/importar desde la migración 012. Las tarifas actuales no recalculan ventas anteriores.
- Solo pagos `verified` aportan ingresos. Los pendientes, cancelados y marcados como reembolsados se separan y aportan cero a los ingresos verificados.
- El transporte tiene su importe y conteo propios: no suma otra entrada vendida al concierto.
- Los accesos gratuitos se cuentan aparte de las entradas pagadas. Las entradas antiguas o externas sin líneas financieras se muestran como **sin importe registrado** y no se consideran gratuitas ni se les inventa un ingreso.
- Anular el QR no equivale a devolver dinero. Si una entrada anulada mantiene un pago verificado, la venta permanece en el bruto y el panel lo advierte.
- Los totales no calculan importes netos, comisiones ni devoluciones parciales sin datos específicos. Un pago marcado como reembolsado se excluye, pero no se deduce que su importe registrado sea la cantidad efectivamente devuelta.

La consulta trabaja sobre una única instantánea de base de datos. La actualización es manual y muestra la hora de consulta. Los errores de conexión o permiso se presentan como errores, nunca como ingresos cero.

## Validación y publicación

Migración `202611030013_event_finances.sql`: aplicada al proyecto vinculado después de validar las consultas con fixtures y rollback. Agrega una RPC de consulta, sin recalcular ni modificar ventas. El frontend está en la carpeta local, pendiente de publicación en Netlify.

`supabase/tests/event_finances.sql` comprueba totales y desgloses, precios históricos, transporte separado, acreditaciones, importes desconocidos, estados de pago, anulaciones, fechas de Costa Rica, filtros, eventos vacíos y permisos. Toda la prueba termina con rollback y usa cuentas ficticias.

Las pruebas de interfaz comprueban navegación por rol, totales y transporte, filtros y CSV, errores sin mostrar ceros falsos, vista móvil y evento vacío. Se mantiene la compilación TypeScript/Vite y la carga diferida del panel.
