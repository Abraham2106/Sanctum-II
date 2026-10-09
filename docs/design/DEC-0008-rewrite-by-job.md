# DEC-0008 — Reescritura por trabajo, en los archivos que ya no caben

- Status: `accepted`
- Decider: planner
- Date: 2026-10-08
- Supersedes: la frase de DEC-0003 que prohibía reescribir. El resto de DEC-0003 sigue: un dueño por concepto, sin comportamiento nuevo.

## Decision

Se reescriben solo los cinco archivos que pasan de 400 líneas. Cada uno se parte por trabajo, no por número de líneas. La clase y las rutas de import que el resto del repo ya usa se quedan. El cuerpo de cada trabajo se muda a un archivo nuevo del mismo seam. El método original queda en una llamada.

Trabajos:

- `src/main.ts` → `src/plugin/turns.ts` (enviar chat y correr mesh), `src/plugin/session.ts` (proyecto activo e hilos), `src/plugin/diagnostics.ts` (indexar, tests de ajustes, orquestar, crear nota). `onload`, settings y `rebuildClients` se quedan en `main.ts`. La clase sigue siendo `SanctumPlugin`.
- `src/app/chat-orchestrator.ts` → `src/app/pending-turn.ts` (confirmación de `pendingAction`) y `src/app/write-turn.ts` (intención de nota, crear, buscar fuente). `handleMessage` se queda y llama a esas funciones.
- `src/ui/projects-view.ts` → `src/ui/projects/list.ts`, `center.ts`, `detail.ts` (lista de proyectos, centro, panel de hilos/memoria/archivos).
- `src/ui/chain-view.ts` → `src/ui/chain-canvas.ts` (nodos, aristas, zoom, arrastre) y el modal de resultado si vive en el mismo archivo.
- `src/ui/kg-view.ts` → `src/ui/kg-scene.ts` (layout, render, zoom) y `src/ui/kg-inspector.ts`.

## Why

El humano pidió reescribir la codebase. Reescribir los archivos chicos no cambia el producto y rompe el diff. Estos cinco mezclan varios trabajos y por eso no se pueden leer de un tirón.

## Consequences

Mismos nombres de clase CSS, mismo DOM, mismas firmas públicas. Los imports existentes de `SanctumPlugin`, `ChatOrchestrator`, `ProjectsView`, `ChainView` y `KgView` no cambian de ruta. Cada archivo nuevo lo importa solo su archivo padre. Citar `DEC-0008` en el archivo nuevo.

## Forbidden

Dependencias nuevas. Cambiar el cable de chat, el contrato de embedding, las rutas del vault o los tests para que encajen. Reescribir archivos de menos de 400 líneas. Partir en helpers de una línea. Correr la suite en esta hoja.

## Cite in code

```text
// DEC-0008: este trabajo vive aparte del archivo que lo mezcla
```
