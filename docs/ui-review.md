# Access: revisión de interfaz y recorridos

Referencia: proyecto local `../santosrock`, sitio `https://santosrock.com/` y permisos de las migraciones existentes. Se confirmó por API que ambos dominios pertenecen al equipo de Netlify `asocul-santosrock`.

## Identidad compartida

- Logo blanco original, copiado como recurso local.
- Barlow Condensed para títulos y DM Sans para interfaz.
- Colores del tema 2027: noche `#061917`, profundo `#02262e`, bosque `#0c403b`, amarillo `#fcf106`, menta `#68c19a` y claro `#ddf9bc`.
- Tailwind 4, DaisyUI 5 y Lucide, como en el sitio principal. Se importan los componentes necesarios de DaisyUI y se mantienen los estilos propios de Access.
- Tratamiento de usted, instrucciones breves y acciones con nombres concretos.

## Navegación por permisos

| Perfil | Inicio del evento | Herramientas |
| --- | --- | --- |
| Propietario o administrador de organización | Resumen | Ingreso, consulta y emisión de entradas, CSV, tipos, correos, estado y equipo |
| Administrador del evento | Resumen | Ingreso, consulta y emisión de entradas, CSV, tipos, correos y estado |
| Supervisor | Resumen | Ingreso y consulta de entradas |
| Personal de puerta | Ingreso | Escáner y resumen con información general |

El frontend refleja los permisos existentes. La autorización continúa en las RPC y RLS. Si falla la consulta de permisos se muestra un error y un reintento, sin habilitar herramientas por defecto.

Entradas separa listado, emisión, CSV, tipos y correos. El resumen prioriza accesos rápidos, métricas y lecturas; los desgloses secundarios se pueden desplegar. El equipo se administra dentro del evento, sin repetir su panel en cada tarjeta del listado.

## Estados y continuidad

- Formularios de entradas y equipo conservan sus datos al cambiar de sección dentro del evento.
- Operaciones pendientes o QR sin guardar bloquean la navegación entre secciones y explican qué falta completar.
- Salir del escáner apaga la cámara y libera su transmisión.
- Se preservan el reintento de la misma solicitud, la confirmación antes de autorizar ingresos y las advertencias de anulación o cierre irreversible.
- Correos distingue consulta, cola registrada, envío pausado y errores. La aceptación del proveedor sigue sin significar entrega confirmada.
- Se quitaron explicaciones de migraciones, variables de entorno y mecanismos internos del texto habitual. No se borraron datos ni eventos cuyo nombre pudiera contener “prueba”.
- Controles táctiles de al menos 44 px, foco visible, enlace al contenido, estados con texto y color, distribución móvil y preferencia de movimiento reducido.

## Validación

- `npm run test:ui`: nueve recorridos en Chrome, con servicios interceptados y un proyecto ficticio. Incluyen roles, conservación de formularios, lectura aprobada/duplicada, QR sin guardar, emisión incierta, error de permisos, ancho móvil y liberación de cámara simulada.
- `npm run test:mail`: nueve pruebas correctas.
- `npm run test:csv`: siete pruebas correctas.
- `npm run build`: correcto; carga diferida del detalle del evento y sin advertencias de tamaño de fragmentos.
- Revisión de capturas de escritorio, móvil e inicio de sesión. Las capturas utilizan datos ficticios y quedan en `test-results/`, excluido de Git.

Para las pruebas de interfaz se usa Chrome local en Windows si está instalado, o el navegador de Playwright. Se puede indicar otro ejecutable con `PLAYWRIGHT_EXECUTABLE_PATH`.

## Alcance y límites

Cambios implementados localmente; esta revisión no publica un despliegue ni cambia variables de correo. La validación de navegador utiliza datos simulados; la comprobación con cuentas reales por rol queda para la revisión del usuario.

El equipo todavía se identifica por ID de cuenta, porque los datos disponibles no incluyen un directorio de nombres y correos. Mejorarlo requiere un flujo de directorio e invitaciones que respete los permisos existentes.
