# Eliminación de eventos de prueba

La migración 014 agrega una operación transaccional para eliminar un evento completo y sus datos de prueba. Está aplicada al proyecto vinculado.

## UI

En **Evento → Resumen**, al final, **Eliminar evento de prueba**. Solo lo ve el propietario de la organización. Para ejecutarlo debe confirmar que el evento y sus ventas son de prueba y escribir el nombre exacto. El servidor verifica propietario, nombre y confirmación; los permisos administrativos o de supervisión por sí solos no permiten eliminar.

La aplicación no puede determinar por los nombres o importes si una venta fue real. Esa confirmación corresponde al propietario. Para eventos reales se debe conservar el historial.

La eliminación retira entradas, credenciales QR, lecturas, órdenes, líneas financieras, importaciones, solicitudes de idempotencia, tipos, asignaciones al evento y trabajos de correo. Elimina los titulares asociados únicamente si ya no están referenciados por otras entradas. Conserva cuentas, organización, membresías de organización y presupuesto diario de correo.

La auditoría se mantiene: el evento eliminado queda identificado en sus metadatos y se registra `event.test_deleted`. Las ejecuciones administrativas desde CLI registran actor nulo; las ejecuciones desde la UI registran al propietario autenticado.

La operación bloquea el evento mientras se ejecuta y rechaza eliminarlo si hay un correo en procesamiento. El acceso directo al procedimiento interno se revoca para usuarios de la API.

## Limpieza autorizada en este chat

El usuario confirmó explícitamente que ambos eventos eran de prueba y autorizó eliminarlos:

- **Santos Rock — Evento de prueba**: 8 entradas, 4 órdenes, 10 lecturas y 1 trabajo de correo eliminados; no había líneas financieras.
- **Semillas - Test**: evento vacío eliminado.

La ejecución se limitó a sus IDs y nombres exactos, en una misma transacción. La comprobación devolvió cero eventos y entradas restantes para esos IDs.

## Validación

- SQL con fixtures y rollback: eliminación de dependencias, conservación de otro evento y de un titular compartido, eliminación de titulares huérfanos, auditoría conservada, nombre y confirmación obligatorios, permisos y rechazo durante un envío en procesamiento.
- Tres recorridos de navegador con datos simulados: doble confirmación, regreso a la lista, error de correo en procesamiento y ausencia del control para supervisor.
- Compilación TypeScript/Vite correcta.

El control de UI está preparado localmente y requiere publicar el frontend para aparecer en producción.
