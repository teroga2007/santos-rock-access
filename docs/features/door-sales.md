# Venta en puerta

Acceso desde **Evento → Venta en puerta**, con un acceso directo en el resumen. Se conservan los permisos de emisión: propietario, administrador de organización o administrador asignado al evento. Supervisores y personal de escaneo no reciben nuevos permisos de venta.

## Recorrido

1. Seleccionar la tarifa del concierto. La tarifa configurada de ₡16.000 se selecciona inicialmente si existe; no se crea ni se modifica una tarifa automáticamente.
2. Registrar nombre del titular y medio de pago: efectivo, SINPE, tarjeta u otro.
3. En efectivo, indicar cuánto se recibió y revisar el vuelto. En otros medios, registrar la referencia.
4. Confirmar que se verificó y recibió el pago; registrar la venta.
5. Entregar o descargar el QR y confirmar su entrega para continuar con la siguiente venta.

El correo del titular es opcional y queda en un bloque secundario. La puesta en cola de correo conserva el flujo existente y el interruptor de envío. La venta no procesa cargos en bancos o tarjetas: registra el pago verificado manualmente por el operador. Emitir el QR tampoco registra el ingreso; se valida posteriormente en el escáner.

## Transporte

Por indicación del usuario, **no se vende transporte en puerta**. El selector excluye paquetes que lo incluyen, y la RPC de puerta también los rechaza. La emisión general rechaza esos paquetes cuando se usa el origen `door`; la UI deshabilita esa combinación.

La emisión e importación anticipadas conservan las tarifas y el desglose de transporte de los incrementos anteriores.

## Registro financiero y continuidad

- Cada venta genera una entrada, un QR y una orden con origen `door`, independientemente del medio de pago.
- Se guardan `payment_method`, `cash_received_crc` y `cash_change_crc` en la orden. El backend calcula el vuelto y verifica efectivo suficiente, referencia, precio vigente y confirmación de pago.
- Concierto e ingreso bruto provienen de la tarifa registrada en `order_items`. El reporte financiero incorpora un desglose por medio de pago. Los registros anteriores sin ese dato aparecen como **Sin registrar**, sin inferir el medio a partir del origen.
- La identidad de la solicitud incluye los datos del pago. Los reintentos devuelven la misma venta y el mismo vuelto; cambiar el importe recibido o el medio con el mismo ID se rechaza.
- Una tarifa cambiada antes de confirmar exige revisar el total y confirmar nuevamente. Una venta ya registrada conserva su precio y puede recuperarse por reintento aun si el evento se cerró posteriormente.
- Una solicitud incierta mantiene su QR y datos en memoria y bloquea salir de la sección hasta confirmar. No se muestra el QR como emitido antes de la respuesta válida.
- El evento debe estar publicado o en vivo. El cierre o cancelación impide ventas nuevas.

La migración 015 agrega columnas a las órdenes y a la tabla existente de solicitudes, sin nuevas dependencias que impidan la limpieza de eventos de prueba. No crea eventos ni ventas reales.

## Validación

- `supabase/tests/door_sales.sql`: efectivo y vuelto, cuatro medios de pago, referencias, rechazo de transporte tanto en puerta como en emisión general, conciliación de totales financieros, tarifas cambiadas, reintentos sin duplicados, confirmación obligatoria, efectivo insuficiente, roles y estados del evento. Fixtures con rollback.
- Cinco nuevos recorridos de UI: efectivo y entrega de QR, SINPE con referencia y exclusión de gratuitos, reintento incierto, cambio de precio y diseño móvil. Los servicios se simulan y no se envían correos.
- Suite de interfaz: 24 pruebas correctas. Compilación TypeScript/Vite correcta.

El frontend queda preparado en la carpeta local para su publicación en Netlify.
