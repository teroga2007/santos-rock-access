# Compras con varias entradas

Una compra indica nombre, correo opcional y cantidad. Cada entrada conserva un QR aleatorio independiente, un único ingreso y su propio estado; no se multiplica el acceso de un mismo código. El comprador puede entregar un PNG diferente a cada acompañante. Las filas de entradas siguen siendo individuales para consultar y anular o reemitir un QR concreto.

## Emisión y puerta

Cantidad entre 1 y 100 por operación. Se muestran los importes multiplicados, con transporte separado. Las ventas pagadas conservan la confirmación de pago, pero no requieren referencia SINPE. En puerta siguen excluidos los tipos con transporte; efectivo y vuelto se calculan sobre la compra completa. Cambiar cantidad, tipo, medio o importe obliga a confirmar nuevamente el pago. Una entrada permite descargar PNG; varias, un ZIP con PNG numerados.

## CSV actual

```csv
nombre,correo,cantidad
Javier,javier@example.com,3
Sol,sol@example.com,2
Entrega manual,,1
```

Una fila por comprador, mismo tipo y origen por archivo. El correo puede estar vacío si se entregarán los QR manualmente. La cantidad es obligatoria, entera y positiva. El límite es **100 entradas en total**, no 100 filas con cantidades ilimitadas. La vista previa distingue compradores, entradas y monto total; permite ordenar sin cambiar el orden original del lote.

Usar la plantilla nueva: la anterior con referencia se rechaza con indicación de actualizarla. Filas duplicadas de nombre/correo deben unificarse sumando cantidades. Personas distintas pueden compartir correo. La descarga ZIP incluye un archivo por entrada y personas.csv con fila, comprador, cantidad, número de entrada y archivo correspondiente; el manifiesto protege contra fórmulas de hojas de cálculo.

## Correo y reintentos

Se agrupan los QR de **la misma operación, evento y destinatario**. Tres entradas para un correo producen un mensaje con tres PNG y tres códigos manuales numerados. No se acumulan indefinidamente compras hechas en operaciones diferentes. Un mensaje con varios adjuntos consume un intento del cupo diario; por defecto 80 mensajes/día. La cola muestra un envío por grupo con cantidad de entradas y canceladas.

Las entradas utilizadas, anuladas o con credenciales revocadas se excluyen antes de enviar; las demás permanecen disponibles. Reintentar un envío rechazado conserva el grupo y no vuelve a emitir ni cobrar. Los resultados inciertos no se reenvían automáticamente. Un fallo al preparar cualquier adjunto evita enviar un grupo incompleto sin aviso.

## Base de datos

La RPC issue_ticket_purchases valida cantidad, credenciales, precio esperado, pago, permisos y cupo del conjunto. La operación es atómica: todos los tickets y sus líneas financieras se confirman juntos. purchase_id relaciona las entradas de un comprador. La respuesta se conserva con digest de entrada; repetir la misma solicitud devuelve el resultado original y cambiar sus datos se rechaza. Un CSV idéntico del mismo evento/tipo/origen, incluso reordenado, no se vuelve a importar. Una compra manual posterior sí puede ser intencional. Cantidad siempre significa entradas nuevas: cambiar la cantidad de un CSV no modifica ni reemplaza una importación anterior.

Los precios por entrada se guardan como instantáneas; se suman sin duplicar admisión ni transporte. Los importes históricos no se reescriben. Las referencias existentes se conservan y las nuevas pueden ser nulas; no se inventan referencias SINPE.

Migraciones 020–022: compras, agrupación de entregas y validación de pertenencia del grupo. Compatibilidad: los endpoints anteriores se conservan; el nuevo worker usa una RPC de claim distinta para no cambiar el cómputo diario del worker antiguo durante la transición. La base se actualiza antes de publicar frontend y funciones juntos.

## Verificación

Pruebas de parser, interfaz y worker con servicios simulados; SQL transaccional en supabase/tests/ticket_purchases.sql con rollback. Incluyen cantidades, cupos sin inserciones parciales, precio/pago, reintentos, CSV repetido, importes y vuelto, QR independientes, agrupación por destinatario, descarte de QR obsoletos y presupuesto por mensaje. No se envían correos reales durante las pruebas.

Después de desplegar: en Test emitir tres entradas para un buzón controlado, seleccionar envío, esperar un único correo con tres PNG, canjear cada uno una vez y comprobar duplicado al repetir. Verificar la conciliación de los tres importes. No canjear/anular antes de recibir el mensaje.
