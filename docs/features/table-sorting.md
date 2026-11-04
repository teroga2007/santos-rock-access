# Ordenamiento de tablas

Los encabezados de datos alternan entre ascendente y descendente al pulsarlos. La columna activa muestra una flecha y expone `aria-sort`; los botones admiten teclado y tienen un área táctil de al menos 44 px. Las columnas de acciones no se ordenan.

Disponible en:

- Entradas emitidas: titular, tipo, origen, estado y fecha.
- Correos: destinatario, estado e intentos.
- Tipos y precios: nombre, concierto, transporte y total.
- Finanzas: tablas por origen, detalle por concepto y medio de pago.
- Resumen de acceso: origen, tipos y cupos, últimas lecturas.
- Vista previa CSV: fila, nombre, correo y referencia.

Importes, cantidades y fechas se comparan con sus valores originales, no con el texto formateado. El texto usa orden en español. Los datos sin valor se colocan al final en las tablas locales. El orden elegido se conserva durante la actualización de datos de una tabla montada; no se guarda como preferencia de cuenta.

## Paginación y CSV

La migración 017 ya está aplicada e incorpora RPC de lectura para ordenar entradas y correos **antes** de aplicar límite y desplazamiento. El cambio de columna o dirección regresa a la primera página y los empates tienen un criterio estable por ID. Se mantienen los permisos existentes: supervisor puede consultar entradas, mientras que la cola de correo requiere administración del evento. Las RPC validan columnas permitidas y no exponen credenciales o contenido cifrado.

El orden de la vista previa CSV no modifica las filas originales, sus números de línea, el contenido enviado al backend ni la correspondencia con los QR. La exportación del detalle financiero sigue el orden visible de esa tabla y sus filtros aplicados.

## Validación

- SQL con 25 entradas y correos, paginación, intentos numéricos, nombres con tildes, empates de fecha, columnas inválidas y permisos. Los fixtures terminan en rollback.
- Cuatro recorridos de navegador: dinero ascendente/descendente y teclado; entradas paginadas; intentos de correo entre páginas; CSV ordenado visualmente con payload original.
- Compilación y revisión de los recorridos existentes de la interfaz.

El frontend se prepara localmente para publicar en Netlify.
