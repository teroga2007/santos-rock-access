# Pruebas de aceptación — Test - Festival Santos Rock 2027

Usar únicamente el evento de prueba. Owner: asocul.santosrock; supervisores: javiersolvar y lopezsandisol; scanner: teroga2007. El owner original también conserva acceso. Usar dispositivos o perfiles de navegador separados; confirmar el nombre de sesión y el nombre del evento antes de cada bloque.

Registrar cada caso como Aprobado / Falló / No probado, junto con dispositivo, usuario y evidencia. Esta lista es para ejecución humana; las pruebas automatizadas no sustituyen cámara, red ni recepción real de correo.

## 1. Sesión y permisos — todos

- [ ] Cada persona entra con su propia cuenta; el encabezado muestra su username e inicial en Eventos y dentro del evento, también en móvil.
- [ ] Salir cierra la sesión; volver atrás o abrir una URL protegida exige ingresar. Volver a entrar muestra la cuenta correcta.
- [ ] Los dos supervisores y el scanner ven tanto el evento real asignado como Test; realizar todas las operaciones siguientes en Test.
- [ ] Owner: puede administrar evento/equipo, emitir/importar, vender en puerta, consultar finanzas y escanear.
- [ ] Supervisores: pueden consultar resumen, entradas y finanzas, y escanear; no pueden emitir/importar, vender en puerta, modificar precios/equipo ni borrar eventos.
- [ ] Scanner: abre Ingreso por defecto; puede escanear y consultar resumen, sin Entradas, Finanzas, Equipo ni Venta en puerta.
- [ ] Intentar acceder a funciones restringidas no cambia datos ni habilita acciones. Que una pestaña esté oculta no basta para validar permisos.

## 2. Preparar tipos y estados — owner

- [ ] Crear General de ₡10.000, General + transporte con ₡10.000 de entrada y ₡7.500 de transporte, Puerta de ₡12.000 sin transporte y Cortesía gratuita.
- [ ] Editar un precio y verificar que persiste al recargar. Eliminar un tipo vacío; uno utilizado conserva su historial y no se puede borrar.
- [ ] Publicar Test; antes de iniciar ingreso, intentar un canje: debe rechazarlo sin consumir la entrada.
- [ ] Preparar los casos del siguiente bloque y guardar sus QR. Luego iniciar ingreso y verificar que todos ven En vivo.

## 3. Emisión, CSV y dinero — owner; supervisores verifican

Crear personas ficticias con nombres distintos. Correos solo de buzones bajo control del equipo. No usar pagos reales.

| Caso | Operación | Total esperado |
| --- | --- | --- |
| A | Una General por SINPE | ₡10.000 |
| B | Una General + transporte | ₡17.500 |
| C | Una Cortesía | ₡0 |
| D, E, F | CSV de tres General pagadas, cantidad 3 | ₡30.000 |
| G | Una venta en puerta en efectivo | ₡12.000 |

- [ ] Antes de emitir, comprobar tipo, importe, cantidad y comprador. Las ventas pagadas exigen confirmación de pago; no requieren referencia SINPE; cortesía funciona sin pago.
- [ ] No se puede abandonar una operación con QR pendiente sin completar la acción que pide la interfaz. Descargar cada QR y verificar que abre.
- [ ] CSV: descargar plantilla, usar nombre/correo/cantidad y revisar la vista previa antes de importar. El archivo admite de 1 a 100 entradas en total: dividir archivos mayores.
- [ ] Probar CSV inválido con correo incorrecto, cantidad vacía, decimal o cero y comprador duplicado dentro del mismo archivo: informar fila y bloquear importación. Corregir y probar el archivo válido.
- [ ] Importar D/E/F una sola vez, descargar ZIP y comprobar tres PNG/filas del manifiesto. No asumir que repetir el archivo en una operación nueva evita duplicados.
- [ ] Probar venta en puerta con efectivo insuficiente y suficiente; confirmar vuelto. Probar también SINPE sin referencia en una entrada adicional y registrarla aparte del total base.
- [ ] En puerta no se ofrece transporte y no se usa el tipo combinado.
- [ ] Antes de anulaciones y pruebas adicionales, reconciliar la base: 7 entradas emitidas; 6 pagadas y 1 gratuita; ₡62.000 de admisión + ₡7.500 de transporte = ₡69.500. Si agregaron entradas extra, sumar sus importes por separado.
- [ ] Owner y ambos supervisores ven los mismos totales; filtrar por tipo/origen, ordenar columnas asc/desc y exportar CSV. El transporte se cuenta separado.

## 4. Correo — owner

- [ ] Con correo informado y envío sin seleccionar, emitir no programa correo.
- [ ] Seleccionar envío en una entrada nueva de prueba: comprobar destinatario y estado Pendiente. Contabilizar esa entrada aparte de la base anterior.
- [ ] Esperar al worker (cada 15 minutos, sujeto a cola y cupo diario): comprobar recepción en bandeja/spam, remitente y PNG adjunto. Aceptado por proveedor no significa entrega confirmada.
- [ ] Copiar del correo el Código de ingreso manual completo (sra1_…), abrir Ingreso → Cargar imagen o ingresar código, pegarlo en Código de la entrada y pulsar Registrar ingreso: debe autorizarlo. Después cargar el PNG del mismo correo: debe indicar Entrada ya utilizada. El código manual no es el UUID de la entrada.
- [ ] CSV: el envío seleccionado solo incluye filas con correo; las demás conservan su descarga de QR.
- [ ] Si ocurre un error real, reintentar únicamente el correo; no volver a emitir ni cobrar. No provocar fallos del proveedor ni consumir deliberadamente el cupo.

## 5. Control de ingreso — scanner y supervisores

Reservar al menos un QR sin usar para cada caso que lo necesite.

- [ ] Permitir cámara y leer un QR nuevo: aprobación, tipo/zona correctos y aumento de un ingreso.
- [ ] Leer el mismo QR desde otro dispositivo y mediante código manual: duplicado, sin nuevo ingreso.
- [ ] Cargar una imagen PNG y pegar un código válido manualmente; ambos caminos funcionan.
- [ ] Dos personas escanean al mismo tiempo el mismo QR nuevo: una sola aprobación; la otra respuesta es duplicado. Repetir con dos QR distintos: ambos ingresan.
- [ ] QR desconocido/malformado: rechazo claro, sin alterar conteos. QR de otro evento: rechazo en Test; no consumir una entrada del evento real para esta prueba.
- [ ] Denegar cámara: mensaje útil y alternativas de imagen/código disponibles. Salir del escáner libera la cámara.
- [ ] Cortar internet antes de leer: no mostrar aprobación inventada; reconectar y verificar estado antes de reintentar. La operación requiere conexión.
- [ ] Verificar en Resumen los ingresos, pendientes y últimas lecturas desde otra sesión; esperar la actualización automática o refrescar.

## 6. Anulación y reemisión — owner

- [ ] Anular una entrada sin usar con motivo: su QR se rechaza y se actualizan estados/conteos.
- [ ] Reemitir otra sin usar con motivo: el QR anterior deja de servir, el nuevo permite una sola entrada. No se crea una segunda venta.
- [ ] Si corresponde, enviar el nuevo QR al correo registrado; el anterior no debe rehabilitarse.
- [ ] Una entrada ya utilizada no permite las mismas acciones de una pendiente. Finanzas conserva la trazabilidad de la venta; una anulación de QR no debe confundirse con un reembolso.

## 7. Cierre y preparación del evento real — al final

- [ ] Solo después de completar las demás pruebas, cerrar ingreso en Test; comprobar rechazo de nuevos canjes/emisiones. La UI no permite reabrirlo.
- [ ] No borrar Test durante la reunión. Registrar incidencias y resultados antes de decidir su limpieza.
- [ ] Acordar responsables de emitir/importar, conciliar pagos, supervisar y escanear; definir dispositivos, cargadores, conectividad y alternativa de acceso a internet.
- [ ] Para el evento real: confirmar nombre/fecha/lugar/capacidad/precios y asignaciones; revisar totales iniciales y que no tenga datos ficticios.
- [ ] Depurar duplicados entre todos los archivos, validar cantidades y separar CSV en lotes de hasta 100 entradas. Empezar por un lote pequeño verificado antes de continuar; conservar respaldo y manifiestos.
- [ ] Activar correo solo en las filas que se necesiten y respetar el cupo disponible. Confirmar qué canal usará el resto para recibir su QR.
- [ ] No importar masivamente ni iniciar ingreso real mientras haya fallos de permisos, doble ingreso, precios, conciliación o pérdida de QR sin resolver.

## Registro de incidencias

| Caso | Usuario/dispositivo | Resultado esperado | Resultado observado | Evidencia / pendiente |
| --- | --- | --- | --- | --- |
| | | | | |

## Compra múltiple y correo agrupado

- [ ] Emitir 3 entradas al mismo correo: total multiplicado, tres QR diferentes y un ZIP con tres PNG.
- [ ] Esperar un solo correo con tres PNG y códigos manuales numerados; después canjear cada entrada una vez. Repetir una no bloquea a sus acompañantes.
- [ ] CSV con cantidades 2 y 3: 2 compradores, 5 entradas; si comparten correo, se programa un único mensaje.
- [ ] Venta en puerta por 2: verificar cobro/vuelto por ambas y ausencia de transporte.
- [ ] Una cantidad que supera el cupo no crea entradas parciales. Reintentar una confirmación incierta no duplica la compra.
