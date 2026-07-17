# Rework de Interfaz — Sanctum-II
### Mesh de agentes · RAG · Chat multi-agente

> **Método.** Este documento sigue el skill **`ui-ux-pro-max`** (tabla de prioridades 1→10 y flujo de *design system*). Como el paquete adjunto solo incluía `SKILL.md` (sin `scripts/search.py` ni `references/`), **no se ejecutó la base de datos de búsqueda**; las recomendaciones provienen de los *defaults* integrados del skill + **Notion y sus agentes como referencia artística**. Donde el skill pediría un match de BD, se indica.

---

## 0. Resumen ejecutivo

Sanctum-II ya tiene una **arquitectura de información sólida** (Mesh visual, Proyectos con RAG, Chat con Trace) pero la capa visual está en modo "funcional/prototipo": jerarquía plana, contraste bajo, densidad inconsistente, acento morado usado sin sistema y tres pantallas que no comparten el mismo lenguaje.

La referencia de Notion aporta exactamente lo que falta: **disciplina neutral, jerarquía por espacio y peso (no por color), un solo acento contenido, iconografía outline monocroma y agentes con identidad visual amable (avatar circular de color).**

Objetivo del rework: pasar de "tres pantallas distintas" a **un solo producto coherente, calmado y legible**, sin perder la densidad que un tool de agentes necesita.

---

## 1. Análisis de la UI actual (por pantalla)

### 1.1 Mesh — Orquestador de agentes
**Qué funciona**
- Canvas de nodos con conexiones punteadas: metáfora correcta para encadenar agentes.
- Lista lateral de agentes con `@handle` y descripción corta.
- Instrucciones "Cómo encadenar" visibles para onboarding.

**Qué falla**
- La barra superior (Abrir, Auto, 🗑, 💾, Ejecutar) mezcla acciones destructivas, de guardado y la acción primaria sin jerarquía: todos los botones pesan igual.
- Los nodos flotan sin "grid" ni alineación; el canvas se ve vacío arriba y a la derecha.
- Los handles de conexión (puntos) son diminutos → objetivo táctil < 44px (rompe Prioridad 2).
- El panel de ayuda compite en peso visual con la lista de agentes real.
- Sin estado de nodo (idle / corriendo / error / hecho): al ejecutar no hay feedback.

### 1.2 Proyectos
**Qué funciona**
- Patrón maestro-detalle claro: lista de proyectos → detalle → paneles de contexto.
- Los paneles derechos (Instrucciones, Carpetas, Índice RAG, Memoria, Archivos) exponen el modelo mental del producto.

**Qué falla**
- **Tres columnas de igual peso** → la vista no dice dónde mirar primero.
- Métricas clave (0 chunks · 1 carpeta · 0 memorias; Chunks 0, Embeddings, top-5/sim≥0.65) están como texto plano, no como datos escaneables.
- El input "Continuar en el contexto…" y el botón morado "Enviar" flotan sin card; el badge `deepseek-v4-flash` aparece suelto.
- Tarjetas del panel derecho con relleno y bordes inconsistentes.
- "Soltá archivos aquí" (dropzone) tiene poco contraste y área ambigua.

### 1.3 Chat (multi-agente)
**Qué funciona**
- Selector de agente lateral con rol (`INTERNO` en Critic) — buena señal.
- Panel derecho **Trace & Fuentes**: diferenciador fuerte del producto.
- Toggle Chat / Mesh / 🔗 en el composer.

**Qué falla**
- El acordeón lateral (Identidad, System Prompt, Contexto RAG, Permisos, Índice del vault) se confunde con la lista de agentes: dos navegaciones distintas apiladas sin separador.
- El mensaje de bienvenida ocupa toda una card grande; los mensajes futuros no tienen patrón de burbuja/rol definido.
- Trace vacío no orienta ("El trace del último Mesh aparecerá aquí") — buen empty state, pero visualmente débil.
- Estado del vault ("116 chunks", punto verde) escondido abajo a la izquierda, donde nadie mira.

### 1.4 Diagnóstico transversal
| Problema | Prioridad del skill | Impacto |
|---|---|---|
| Contraste texto secundario sobre fondo oscuro insuficiente | 1 · Accesibilidad · CRÍTICO | Legibilidad |
| Handles/botones < 44×44px, sin feedback de acción | 2 · Touch & Interacción · CRÍTICO | Usabilidad |
| Acento morado sin token semántico (usado en botón, badge, nodo) | 6 · Tipografía & Color · MEDIO | Coherencia |
| Tres columnas de igual peso, sin jerarquía | 5 · Layout · ALTO | Foco |
| Sin estados de nodo/mensaje/loading | 2 + 8 · Feedback | Confianza |
| Iconografía mixta y tamaños dispares | 4 · Style · ALTO | Pulido |

---

## 2. Referencia artística: Notion y sus agentes

De la captura de Notion (agentes *Notion AI, Bold Steward, Majestic Emissary, Curious Forager* + panel de Settings) se extraen los principios a imitar:

1. **Neutral primero, color con moderación.** Casi todo es gris/negro; el color aparece solo en avatares de agente y en la acción primaria. Nada de fondos de color en superficies grandes.
2. **Jerarquía por espacio y peso, no por cajas.** Notion casi no usa bordes; separa con *whitespace*, tamaño y peso tipográfico. Las secciones (Triggers, Instructions, Tools and access) se distinguen por encabezado + aire, no por tarjetas de colores.
3. **Agentes = avatar circular de color + nombre.** Identidad amable y reconocible. Cada agente tiene un color propio consistente en toda la app.
4. **Iconografía outline monocroma**, tamaño uniforme (~16–20px), alineada a la baseline del texto.
5. **Un solo acento de marca** (azul en Notion) reservado para foco, links y CTA. Los toggles y estados usan ese acento; el resto es neutro.
6. **Composer central minimalista**: campo grande, placeholder claro ("Ask …"), acciones secundarias como chips discretos debajo.
7. **Paneles de configuración como listas de secciones etiquetadas** ("When should this agent run?", "What can the agent use?") — texto guía en gris, control a la derecha.

---

## 3. Sistema de diseño propuesto

> Dials del skill sugeridos: **`--variance 3`** (minimal, centrado en contenido), **`--motion 3`** (micro-interacciones sutiles), **`--density 6`** (estándar-denso: es un tool, no una landing). Fuente: defaults del skill (sin match de BD).

### 3.1 Color (dark-first, tokens semánticos)
Adoptar la disciplina neutral de Notion y **contener el morado** como único acento de marca.

```css
:root[data-theme="dark"] {
  /* Superficies (de más profundo a más elevado) */
  --bg-app:        #171717;  /* lienzo / fondo app */
  --bg-surface:    #1e1e1e;  /* paneles, sidebar */
  --bg-elevated:   #262626;  /* cards, nodos, popovers */
  --bg-hover:      #2e2e2e;

  /* Bordes (hairline, casi invisibles como en Notion) */
  --border-subtle: rgba(255,255,255,0.07);
  --border-strong: rgba(255,255,255,0.13);

  /* Texto (respetar contraste 4.5:1 — Prioridad 1) */
  --text-primary:   rgba(255,255,255,0.92);
  --text-secondary: rgba(255,255,255,0.63); /* subir desde el gris actual */
  --text-tertiary:  rgba(255,255,255,0.45); /* solo labels/meta, nunca body */

  /* Acento de marca (morado contenido) */
  --accent:        #8b7cf6;  /* CTA, foco, links */
  --accent-hover:  #a394f8;
  --accent-subtle: rgba(139,124,246,0.14); /* fondos de selección/chips */

  /* Estados semánticos (para nodos y feedback) */
  --success: #4caf7f;  /* nodo "hecho", vault online */
  --running: #e0b341;  /* nodo ejecutando */
  --error:   #e5637a;  /* nodo/validación en error */
  --info:    #5b9bd5;
}
```

**Colores de agente** (avatar circular, como Notion). Asignar un color fijo por agente y reutilizarlo en Mesh, lista y chat:

| Agente | Color | Uso |
|---|---|---|
| Forager | `#4caf7f` verde | avatar + borde de nodo |
| Researcher | `#5b9bd5` azul | avatar + borde de nodo |
| Critic | `#e0a341` ámbar | avatar + borde de nodo |
| Web Search | `#8b7cf6` morado | avatar |
| Agente Base | `#9b9b9b` neutro | avatar |

### 3.2 Tipografía
Inter (o `-apple-system` / system-ui) como en Notion. Jerarquía por peso y tamaño, no por color.

| Rol | Tamaño | Peso | Line-height |
|---|---|---|---|
| Título pantalla (H1) | 22px | 600 | 1.3 |
| Sección (H2) | 15px | 600 | 1.4 |
| Body | 15px | 400 | 1.5 |
| UI / label | 13px | 500 | 1.4 |
| Meta / caption | 12px | 500 | 1.4 |
| Mono (handles `@`, chunks, código) | 13px | JetBrains Mono / ui-monospace | 1.5 |

Reglas (Prioridad 6): body nunca < 14px, evitar gris-sobre-gris, tokens de color en vez de hex crudo en componentes.

### 3.3 Espaciado, radios y elevación
```css
--space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-6:24px; --space-8:32px;
--radius-sm:6px;   /* chips, badges */
--radius-md:10px;  /* cards, nodos, inputs */
--radius-lg:14px;  /* paneles, modales */
--shadow-card: 0 1px 2px rgba(0,0,0,.3);
--shadow-pop:  0 8px 24px rgba(0,0,0,.45);
```
Elevación sutil (sombra ligera + borde hairline), nunca sombras duras. Como Notion: la profundidad se sugiere, no se grita.

### 3.4 Iconografía
- Un solo set **outline monocromo** (Lucide o Phosphor), 18px en UI, 20px en headers.
- Color `--text-secondary`; pasa a `--text-primary` en hover/activo.
- **Prohibido emoji como icono** (Prioridad 4). Reemplazar 🗑/💾/▶ de la barra Mesh por iconos del set.

### 3.5 Motion (`--motion 3`, sutil)
- Duración 150–250ms, easing `cubic-bezier(.2,.0,.0,1)`.
- Transiciones que **comunican**: nodo pulsa al ejecutar, conexión anima el flujo (dash-offset), mensaje entra con fade+8px.
- Respetar `prefers-reduced-motion`. Nunca animar `width/height` (usar `transform/opacity`).

---

## 4. Rework por pantalla

### 4.1 Mesh — Orquestador
**Layout**
- **Jerarquizar la barra superior**: `Ejecutar` como único botón primario (acento morado, icono play). `Auto`, `Abrir`, `Guardar` como botones ghost. `Eliminar` movido a un menú `⋯` o solo activo con selección (evita destructivo prominente).
- Canvas con **grid de puntos sutil** y *snap* de alineación; "Auto-layout" alinea nodos en el flujo Forager → Researcher → Critic.
- Panel izquierdo dividido en 2 zonas separadas por divisor: **Agentes** (lista) y, colapsable, **Cómo encadenar** (ayuda, cerrada por defecto tras el primer uso).

**Nodos (rework)**
- Card `--bg-elevated`, radius-md, **borde 2px con el color del agente**, avatar circular arriba-izquierda + nombre + `@handle` mono.
- **Handles de conexión ≥ 12px con hit-area de 44px** invisible (Prioridad 2), cursor `crosshair`, resaltan al hover.
- **Estados de nodo**: idle (borde tenue) · running (borde `--running` + pulso) · done (check `--success`) · error (`--error` + tooltip). Da feedback en `Ejecutar`.

### 4.2 Proyectos
**Layout con jerarquía (Prioridad 5)**
- 3 columnas con **peso desigual**: sidebar de proyectos angosta (240px) · detalle central dominante (flex) · contexto derecho (320px).
- Detalle central = **foco**: título + fila de métricas como *stat chips* escaneables, luego composer en card, luego lista de conversaciones.

**Métricas como datos, no texto**
```
[ 0 chunks ]  [ 1 carpeta ]  [ 0 memorias ]      ← stat chips, mono + label gris
```
- Índice RAG: mostrar `Chunks · Embeddings · top-5 / sim≥0.65` como mini-tabla clave/valor; botón "Reindexar" ghost con icono de refresh y **estado** (última indexación / progreso).

**Panel derecho consistente**
- Todas las secciones (Instrucciones, Carpetas, Índice, Memoria, Archivos) usan el **mismo patrón de card**: header con icono outline + título, cuerpo, acción ghost al pie.
- Carpetas con badge de permiso (`LECTURA`/`ESCRITURA`) como chip semántico (neutro/acento), no texto suelto.
- Dropzone de Archivos: borde punteado `--border-strong`, icono + "Soltá archivos aquí", estado hover con `--accent-subtle`.

**Composer**
- Envolver input + `Enviar` + badge de modelo en una **card única**; el modelo (`deepseek-v4-flash`) como chip selector dentro del composer, no suelto.

### 4.3 Chat multi-agente
**Separar las dos navegaciones**
- Zona A: **Agentes** (avatares de color + nombre + rol chip `INTERNO`).
- Divisor.
- Zona B: **Configuración del agente** como acordeón (Identidad, System Prompt, Contexto RAG, Permisos, Índice del vault) con iconos outline. Queda claro que configuran al agente seleccionado.

**Mensajes**
- Patrón de mensaje estilo Notion/documento (no burbujas de colores): avatar del agente + nombre + hora en `--text-tertiary`, cuerpo en body 15px, ancho de lectura máx. ~720px centrado.
- El de bienvenida usa un **callout** discreto, no una card gigante.

**Composer**
- Campo grande "Pregunta para {agente}…", toggle **Chat / Mesh / 🔗** como segmented control, chips de contexto abajo (`Todo /Research/`, `Reindexar`, `Ver RAG`).

**Trace & Fuentes**
- Tabs Trace / Fuentes con línea de acento activa.
- Trace vacío: ilustración/mono + copy guía. Con datos: **timeline vertical** de pasos (agente → acción → tokens/tiempo), cada paso enlaza a la fuente en la pestaña Fuentes.
- Mover el estado del vault (`● 116 chunks`) a un **badge en el header**, no al pie.

---

## 5. Componentes clave (specs rápidas)

| Componente | Regla |
|---|---|
| **Botón primario** | fondo `--accent`, texto blanco 92%, radius-md, alto 36px, hover `--accent-hover`, foco anillo 2px `--accent` |
| **Botón ghost** | transparente, texto secundario, hover `--bg-hover`; para acciones no primarias |
| **Avatar de agente** | círculo 28px, color del agente, inicial o icono; consistente en Mesh/lista/chat |
| **Chip / badge** | radius-sm, 12px mono/label; semántico (permiso, estado, modelo) |
| **Card / panel** | `--bg-elevated`, `--border-subtle`, radius-lg, padding 16–24 |
| **Stat chip** | valor mono grande + label gris pequeño, para métricas RAG |
| **Nodo Mesh** | card + borde de color de agente + estado + handles con hit-area 44px |
| **Input / composer** | card contenedor, foco con anillo `--accent`, placeholder `--text-tertiary` |

---

## 6. Accesibilidad y checklist pre-entrega

**Prioridad 1–3 (crítico/alto):**
- [ ] Contraste texto ≥ 4.5:1 (subir gris secundario a ≥ 0.63 alpha).
- [ ] Todo control accionable ≥ 44×44px de área táctil (handles Mesh incluidos).
- [ ] Foco visible con anillo `--accent` en todos los interactivos; **no** eliminar focus rings.
- [ ] Navegación por teclado en canvas, lista de agentes y acordeón.
- [ ] `aria-label` en botones icon-only (barra Mesh, toggles).
- [ ] Feedback de carga en Ejecutar / Reindexar / Enviar (spinner o estado de nodo).
- [ ] Reservar espacio para contenido async (evitar CLS al cargar trace/chunks).

**Prioridad 4–8:**
- [ ] Iconos SVG outline monocromos, sin emoji.
- [ ] Un solo acento; el resto neutro.
- [ ] Tokens de color/tipografía, cero hex crudo en componentes.
- [ ] Estados de error cerca del campo (permisos de carpeta, indexación fallida).
- [ ] `prefers-reduced-motion` respetado.

---

## 7. Anti-patrones a evitar

- ❌ Fondos de color en superficies grandes (mantener neutral tipo Notion).
- ❌ Tres columnas de igual peso sin foco.
- ❌ Morado repartido sin significado; resérvalo para marca/CTA/foco.
- ❌ Emoji como iconografía funcional.
- ❌ Cambios de estado instantáneos (0ms) sin transición.
- ❌ Métricas importantes como texto corrido en vez de datos escaneables.
- ❌ Dos navegaciones apiladas sin separación (chat).

---

## 8. Roadmap de implementación sugerido

1. **Tokens** (color, tipografía, espaciado) → base compartida por las 3 pantallas.
2. **Componentes** (botón, avatar, chip, card, input) en la librería.
3. **Chat** primero (pantalla más usada) → separar navegaciones + patrón de mensaje.
4. **Proyectos** → jerarquía de columnas + stat chips + composer en card.
5. **Mesh** → barra jerarquizada + nodos con estado + handles accesibles.
6. **QA** con el checklist §6 en light y dark.

---

*Generado siguiendo la metodología del skill `ui-ux-pro-max` (tabla de prioridades integrada). Las recomendaciones de estilo/color/tipografía usan los defaults del skill + Notion como referencia artística, no un match de su base de datos de búsqueda (scripts/references no incluidos en el adjunto).*
