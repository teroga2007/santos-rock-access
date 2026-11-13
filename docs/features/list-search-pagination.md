# Búsqueda y paginación de entradas y correos

Entradas → Listado y Entradas → Correos comparten búsqueda y paginación. Las consultas se ejecutan en Supabase sobre el evento completo antes de ordenar y paginar; no se filtra únicamente lo descargado en pantalla.

## Búsqueda

- Varias palabras en cualquier orden, sin distinguir mayúsculas ni tildes españolas. Por ejemplo, jose sinpe puede combinar el nombre José con su origen de venta.
- Entradas: nombre, correo, tipo, identificador de entrada, origen y estado (incluidas sus etiquetas en español).
- Correos: destinatario, titulares y tipos de las entradas agrupadas, identificador de entrada/envío y estado del grupo. Un titular encontrado devuelve el envío completo con su cantidad de entradas.
- Filtros explícitos de estado; en entradas también de origen. Limpiar filtros restablece la primera página.
- Búsqueda con pausa de 300 ms para evitar una consulta por pulsación. Respuestas de consultas anteriores se descartan cuando cambian los criterios. Los identificadores buscables son UUID, no los tokens privados del QR.

La búsqueda combina coincidencias parciales de todas las palabras; no usa IA ni modifica datos. Los caracteres % y _ se buscan literalmente, sin actuar como comodines SQL.

## Paginación

Muestra rango, cantidad filtrada, total del evento cuando difiere y página actual de total de páginas. En correos distingue mensajes de entradas asociadas. Tamaños de 20, 50 y 100 filas; primera/última, anterior/siguiente, números cercanos e ingreso directo de página. Los cambios de búsqueda, filtros, orden o tamaño vuelven a la primera página.

Si los datos cambian y desaparece la página actual, se consulta la última página válida. Un error muestra el aviso y permite actualizar; no se presenta como cero resultados. La cola conserva su actualización automática y los criterios elegidos.

Los controles usan nombres accesibles, página activa y anuncios de resultados; admiten teclado y se distribuyen en varias líneas en móvil.

## Base y pruebas

Migración 023: search_event_tickets (administradores y supervisores), search_event_email_deliveries (administradores) y función privada de coincidencias. Totales y página provienen de la misma consulta. Los endpoints anteriores se conservan para despliegues compatibles. No se devuelven tokens, cifrados ni texto interno utilizado para agrupar búsquedas.

supabase/tests/search_and_pagination.sql usa fixtures con rollback y comprueba tildes, varias palabras, filtros, conteos en páginas vacías, agrupación, límites de entrada, orden estable y prohibición de lectura a scanner y cuentas ajenas. Las pruebas Playwright cubren navegación, búsqueda fuera de la página visible, tamaños, estados vacíos, errores, teclado y móvil.
