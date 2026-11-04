# Pruebas concurrentes de ingreso

Ejecutadas el 3 de noviembre de 2026 contra el proyecto vinculado `santos-rock-access`. Resultado: **correctas**, con limpieza de los fixtures verificada. Informe estructurado: [concurrency-latest.json](../reports/concurrency-latest.json).

## Qué se comprobó

| Caso | Sesiones | Resultado observado |
| --- | --- | --- |
| Mismo QR, solicitudes distintas | 4 operadores | 1 accepted y 3 duplicate |
| Mismo request_id y operador | 4 sesiones | Mismo resultado accepted; 1 check-in, 1 solicitud y 1 auditoría |
| Anulación contra escaneo | 2 | El escaneo ganó y la anulación se rechazó por entrada utilizada |
| Reemisión contra escaneo | 2 | El escaneo ganó y la reemisión se rechazó por entrada utilizada |
| QR distintos | 4 operadores | 4 accepted, sin interferencia entre entradas |

Las conexiones tuvieron PIDs independientes y períodos de ejecución solapados. El script verifica ambas condiciones y falla si no demuestra concurrencia. Cada operación mantiene su transacción abierta 0,5 segundos después de ejecutarse para provocar contención; por eso **sus tiempos no representan la velocidad del escáner**.

En esta ejecución el canje ganó ambas carreras contra acciones administrativas. Las suites transaccionales anteriores prueban el resultado contrario cuando la anulación/reemisión ya se confirmó. Una sola ejecución concurrente no explora todos los órdenes posibles.

## Repetir

Requiere Node, dependencias instaladas, Supabase CLI accesible mediante npx, sesión de CLI autorizada y un proyecto vinculado con migraciones 001–010. Preferir staging para repetir frecuentemente.

```powershell
npm run test:concurrency -- --remote --project-ref TU_PROJECT_REF
```

No se ejecuta con el comando normal de build ni con `test:csv`. Exige indicar explícitamente el proyecto remoto y comprueba que coincida con el vinculado.

El script crea una organización, evento, 4 scanners, propietario y entradas sintéticas con UUIDs aleatorios. Las cuentas usan `example.invalid`; no envía correos ni utiliza usuarios o entradas reales. Como las sesiones independientes deben ver los fixtures, el setup se confirma temporalmente en vez de usar un rollback único. Al terminar, elimina exclusivamente los registros de esa ejecución, comprobando etiquetas, orden de dependencias y ausencia final de organización, evento y cuentas.

Si la limpieza falla o se cierra forzosamente el proceso, el directorio temporal `sra-concurrency-*` conserva `cleanup.sql`. Ejecutarlo contra el mismo proyecto para recuperar la limpieza. El informe marca `cleanup_verified: false` si no se pudo verificar. El proceso espera a que terminen las solicitudes concurrentes antes de limpiar.

## Límites de esta comprobación

- Usa conexiones SQL reales y claims simulados, no sesiones JWT del navegador ni el recorrido por PostgREST.
- No mide red móvil, cámara, ancho de banda ni dispositivos reales.
- No simula 999 ingresos, 999 conexiones ni una carga sostenida; prueba consistencia con 4 operadores y los casos descritos.
- No constituye una garantía de rendimiento del plan Free. Sigue pendiente una prueba de extremo a extremo en staging, con la cantidad prevista de puertas y ritmo esperado de llegada.

No se necesitaron cambios al esquema o al código de canje para que estas comprobaciones pasaran.
