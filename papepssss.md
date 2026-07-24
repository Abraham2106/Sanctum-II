# Guion de Presentación — Isla Verde (Quantathon 2026, Reto 1)

> Formato: **DIALOGO** = lo que dices tal cual, en voz alta.
> **[POR QUÉ DIGO ESTO]** = contexto para que entiendas lo que estás diciendo y puedas responder preguntas. No se lee en voz alta.
> **[SI TE PREGUNTAN]** = respuestas preparadas para preguntas probables de jueces.

---

## BLOQUE 1 — Quantum Approach Justification

### 1.1 El algoritmo elegido y por qué encaja con el problema

**DIALOGO:**

> "Nuestro problema es *islanding* controlado: ante una contingencia crítica, dividir la red de transmisión de 230 kV del ICE en islas eléctricamente autosuficientes cortando el mínimo peso de líneas posible. Matemáticamente, eso es un problema de corte en grafos de la familia Max-Cut, que es NP-hard.
>
> Elegimos **QAOA** — el Quantum Approximate Optimization Algorithm — por tres razones que vienen de la estructura del problema, no de la moda:
>
> **Primera**: Max-Cut tiene una traducción *directa y sin variables auxiliares* a un QUBO y de ahí a un Hamiltoniano de Ising. Cada subestación es una variable binaria — a qué isla pertenece — y cada línea de transmisión es un término de acople J entre dos qubits. Un nodo, un qubit. Nuestra instancia de 16 nodos usa exactamente 16 qubits, sin sobrecosto de codificación.
>
> **Segunda**: QAOA es el algoritmo variacional *diseñado* para este tipo de Hamiltoniano: el operador de costo del circuito es literalmente el Ising del problema — cada arista del grafo se convierte en una compuerta ZZ en el circuito. La estructura física de la red eléctrica se imprime directamente en la estructura del circuito cuántico.
>
> **Tercera**: es viable en hardware NISQ *hoy*. QAOA usa circuitos poco profundos con profundidad controlable por el parámetro p, y eso nos permitió ejecutarlo en el emulador H2 de Quantinuum con nuestras tres instancias de 8, 12 y 16 qubits."

**[POR QUÉ DIGO ESTO]**
- QUBO = Quadratic Unconstrained Binary Optimization: minimizar `x^T Q x` con `x` binario. El cambio de variable `s = 2x − 1` lo convierte en Ising (coeficientes h, J). Nuestro pipeline (`modelador_red.py`, Fase 4) genera ambos.
- En el circuito (`qaoa.py`): cada capa QAOA alterna el **Hamiltoniano de costo** (una rotación ZZ por arista, con ángulo γ) y el **Hamiltoniano de mezcla** (una rotación Rx por qubit, con ángulo β). Un optimizador clásico (COBYLA) ajusta los ángulos γ, β para maximizar el valor esperado del corte. Es un algoritmo **híbrido**: el circuito propone, el clásico optimiza.
- "Sin variables auxiliares" importa porque otros problemas (con restricciones duras) necesitan qubits extra de holgura; Max-Cut puro no, y por eso 16 nodos = 16 qubits y cabemos en el emulador.

**[SI TE PREGUNTAN] ¿Por qué no annealing cuántico (D-Wave)?**
> "El annealing también consume QUBOs, pero el reto pedía trabajar en el ecosistema de compuertas de Quantinuum, y QAOA nos da control explícito de la profundidad p y estadística reproducible por corrida. Además, nuestro QUBO ya está exportado en formato Ising: correría en un annealer sin cambios."

**[SI TE PREGUNTAN] ¿Qué es p?**
> "p es el número de capas del circuito: cuántas veces alternamos costo y mezcla. A mayor p, más expresivo el circuito y en teoría mejor solución, pero también más profundidad y más ruido en hardware real. Por eso barrimos p = 1, 2, 3 y medimos la razón de aproximación en cada uno."

---

### 1.2 El cuello de botella clásico (why classical methods break down)

**DIALOGO:**

> "¿Por qué considerar métodos cuánticos aquí? Porque esta clase de problema escala de forma brutal para los métodos clásicos exactos.
>
> El óptimo exacto por **fuerza bruta** requiere evaluar 2^n particiones. Con 16 nodos son 65 mil — trivial. Pero la red completa del ICE tiene decenas de subestaciones: con 40 nodos ya son un billón de particiones, y con 60 es simplemente imposible: Max-Cut es NP-hard, no se conoce algoritmo clásico que lo resuelva exacto en tiempo polinomial.
>
> Los métodos aproximados clásicos tienen techos conocidos: **greedy** garantiza apenas el 50% del óptimo, y **Goemans-Williamson** — el mejor algoritmo clásico con garantía, basado en programación semidefinida — garantiza el 87.8%. Y hay un resultado teórico fuerte: bajo la Unique Games Conjecture, *ningún* algoritmo clásico polinomial puede garantizar más que ese 0.878. Es decir: el techo clásico no es tecnológico, es matemático.
>
> Ahí está la apuesta cuántica: QAOA no está sujeto a esa cota, y su garantía mejora al aumentar p. Hoy no supera a GW — y lo decimos con todas las letras en nuestras limitaciones — pero es la familia de algoritmos donde una mejora de hardware se traduce directamente en mejor calidad de solución para esta clase de problemas.
>
> Y hay un segundo cuello de botella operativo: el islanding es una decisión de **emergencia en tiempo real**. GW resuelve un programa semidefinido cuyo costo crece rápido con el tamaño de la red; un dispositivo cuántico muestrea soluciones de un circuito de profundidad fija. A escala de red nacional, ese perfil de escalado es la motivación."

**[POR QUÉ DIGO ESTO]**
- Fuerza bruta: 2^8 = 256, 2^12 = 4 096, 2^16 = 65 536 (nuestras instancias, todas verificables). 2^40 ≈ 10^12, 2^60 ≈ 10^18.
- Greedy ~0.5: cota clásica del algoritmo voraz para Max-Cut.
- GW 0.878: Goemans & Williamson (1995), relajación SDP + redondeo por hiperplano aleatorio. Nuestro pipeline lo implementa con CVXPY.
- Unique Games Conjecture (Khot): si es cierta, 0.878 es inalcanzable de superar clásicamente en tiempo polinomial. Es una conjetura, no un teorema — sé honesto si te lo señalan.
- QAOA p=1 garantiza 0.6924 para Max-Cut (peor que GW — está en nuestras limitaciones); la garantía crece con p.
- **Honestidad clave**: en nuestras instancias pequeñas GW y hasta greedy alcanzan razón ~1.0. La ventaja cuántica NO existe hoy; nuestro argumento es de *estructura y escalado*, no de números actuales.

**[SI TE PREGUNTAN] ¿Entonces QAOA perdió contra los clásicos en sus corridas?**
> "Sí, y lo reportamos sin maquillaje: a p=3 QAOA alcanza r ≈ 0.79 en la instancia de 8 nodos mientras GW llega a 1.0. Eso es exactamente lo que la literatura predice para NISQ. Nuestro entregable no es 'ventaja cuántica': es un pipeline honesto, reproducible y verificado contra el óptimo exacto, listo para el día en que el hardware alcance."

---

### 1.3 Simulador y hardware usado

**DIALOGO:**

> "Nuestra pila de ejecución tiene dos niveles, ambos con versiones exactas pineadas:
>
> **Nivel local**: el bucle de optimización de ángulos — unas 40 evaluaciones por corrida — corre en el simulador **Qulacs** vía pytket, versión pytket 2.18.1 con pytket-qulacs 0.42.0, con semillas fijadas para reproducibilidad total.
>
> **Nivel plataforma**: la validación final corre en el **emulador H2 de Quantinuum**, alojado en Quantinuum Nexus, accedido con qnexus 0.46.0. Los mejores ángulos encontrados localmente se reevalúan una sola vez en H2, y esa es la cifra que reportamos. Así no saturamos la cola compartida del emulador con el bucle de optimización.
>
> La estadística: para cada instancia y cada p, **5 corridas independientes** con inicializaciones distintas, reportando media ± desviación estándar de la razón de aproximación. Nada de cherry-picking: la cifra es el valor esperado del corte, nunca el mejor shot."

**[POR QUÉ DIGO ESTO]**
- Arquitectura híbrida en `qaoa.py`: `evaluar_angulos_local` (Qulacs, rápido, sin red) dentro del bucle COBYLA; `evaluar_angulos_h2` (Nexus) una sola vez al final por corrida.
- Versiones exactas (de `requirements.txt`): pytket==2.18.1, pytket-qulacs==0.42.0, pytket-quantinuum==0.59.1, qnexus==0.46.0, Python 3.12.
- El emulador H2 alojado en Nexus tiene **tope de 20 qubits** — por eso nuestras instancias son 8/12/16.
- "Mejor shot" vs "valor esperado": el mejor shot de una distribución siempre está sesgado alto; reportarlo sería cherry-picking (red flag de la rúbrica).

**[SI TE PREGUNTAN] ¿El emulador equivale a hardware real?**
> "No, y está en nuestras limitaciones: el emulador modela el ruido del H2 pero no es idéntico al dispositivo físico. Lo que sí garantiza es que nuestros circuitos compilan, corren y devuelven distribuciones realistas en la plataforma oficial del reto."

**[SI TE PREGUNTAN] ¿Y el código Iceberg que mencionan en el repo?**
> "Es una extensión opcional de detección de errores cuánticos — el código [[k+2,k,2]] de Quantinuum. La implementamos como módulo autónomo y verificamos que sin ruido reproduce exactamente el resultado sin codificar, con 0% de descarte. Codifica el costo ZZ sin sobrecosto de compuertas, y la literatura — He et al. 2024 — muestra que mejora QAOA bajo ruido hasta 20 qubits lógicos. Está desconectada del pipeline principal para no contaminar la comparación contra los clásicos, pero demuestra el camino hacia early fault-tolerance."

---

## BLOQUE 2 — Impacto en los ODS

### 2.1 Cadena principal (ODS 7)

**DIALOGO:**

> "Nuestra cadena de impacto principal va del resultado computacional al ODS 7 — energía asequible y no contaminante — así:
>
> **Mejor partición de la red calculada por QAOA** → **plan de islanding preventivo que corta el mínimo peso de líneas manteniendo islas autosuficientes** → **una falla local se contiene en su isla en vez de propagarse en cascada** → **menos apagones nacionales y menor uso de generación térmica de respaldo** → **meta 7.1, acceso a energía fiable, y meta 7.2, mantener la matriz renovable**.
>
> El contexto que hace esto especialmente relevante en Costa Rica: cerca del **98% de nuestra electricidad es renovable**. Cada apagón evitado no solo mantiene el servicio — evita despachar térmica de respaldo. Proteger la continuidad del suministro es proteger la matriz renovable misma."

**[POR QUÉ DIGO ESTO]**
- La estructura pedida es exactamente: resultado computacional → efecto operativo → resultado en meta ODS. Memorízala como cadena de flechas.
- Metas concretas: **7.1** (acceso universal a servicios energéticos asequibles y *fiables*) — la palabra clave es fiables, ahí entra la resiliencia. **7.2** (aumentar la proporción de renovables) — un apagón fuerza térmica de respaldo, es decir retrocede 7.2.
- El resultado computacional concreto de nuestro pipeline: la partición óptima (bitstring) de las instancias de la red de 230 kV del ICE, verificada contra fuerza bruta, con el peso de corte minimizado.

### 2.2 Efectos sobre otros ODS

**DIALOGO:**

> "El proyecto toca positivamente otros dos ODS:
>
> **ODS 9 — Industria, innovación e infraestructura**, meta 9.1: infraestructura fiable y resiliente. El islanding controlado convierte la red de transmisión *existente* en infraestructura resiliente por diseño — sin construir una sola línea nueva, solo con inteligencia computacional sobre el activo que ya existe. Y meta 9.5: este proyecto aplica computación cuántica de frontera a un activo crítico nacional, con datos abiertos del ICE, fortaleciendo capacidad tecnológica local.
>
> **ODS 13 — Acción por el clima**, meta 13.1: fortalecer la resiliencia y adaptación ante desastres relacionados con el clima. Costa Rica sufre tormentas y sismos que dañan líneas de transmisión; una red que puede auto-particionarse ante un evento extremo es adaptación climática directa de la infraestructura energética. Además, hay un efecto habilitador: la electrificación del transporte y la industria — la ruta de descarbonización del país — solo es viable sobre una red renovable *confiable*. Nadie electrifica su flota sobre una red que se cae.
>
> Un efecto que vigilamos honestamente: el islanding deliberado implica que algunas cargas quedan temporalmente en islas con menos respaldo — por eso la extensión de nuestro modelo incluye penalizaciones para proteger cargas críticas como hospitales y bombeo de agua, lo que conecta con ODS 3 y ODS 6. Ese es trabajo de la capa de restricciones, probado sobre la instancia de 8 nodos."

**[POR QUÉ DIGO ESTO]**
- Metas exactas por si las piden: **9.1** = desarrollar infraestructura fiable, sostenible, resiliente y de calidad. **9.5** = aumentar la investigación científica y capacidad tecnológica. **13.1** = fortalecer resiliencia y capacidad de adaptación a riesgos climáticos y desastres naturales.
- El punto del "efecto negativo vigilado" es oro ante jueces: demuestra que pensaste los trade-offs. El islanding salva la red completa pero puede dejar islas débiles; nuestra formulación extendida (QUBO con penalizaciones de balance y cargas críticas) lo mitiga *dentro del modelo matemático*, no como promesa.
- ODS 3 (salud: hospitales sin luz) y ODS 6 (agua: bombeo eléctrico) solo se mencionan como conexión de las cargas críticas — no los infles, no son nuestra cadena principal.

**[SI TE PREGUNTAN] ¿Esto no es solo teórico? ¿Qué tan lejos está de operarse?**
> "Las instancias actuales son agregaciones de 8 a 16 supernodos de la red real de 230 kV, construidas desde los datos abiertos del ICE con la malla hexagonal H3. Es escala de demostración, no operativa — y lo decimos en limitaciones. Pero el pipeline es el mismo a cualquier escala: lo que falta es hardware cuántico más grande, no rediseñar el método. Y la jerarquía H3 es exactamente el mecanismo de escalado: refinar la resolución de la malla da instancias progresivamente más grandes de la misma red."

---

## Chuleta de números (para tener en la cabeza)

| Dato | Valor |
|---|---|
| Instancias (nodos = qubits) | mvp8 = 8, std12 = 12, large16 = 16 |
| Óptimos exactos (fuerza bruta) | 83.73 / 113.16 / 291.15 |
| QAOA p=3, razón r (media) | mvp8: 0.788 · std12: 0.676 · large16: 0.711 |
| Corridas por punto | 5, media ± desviación estándar |
| Greedy medido | ~1.0 en mvp8/large16, 0.972 en std12 |
| GW medido | 1.0 en las tres instancias |
| Garantía teórica GW | 0.878 (piso en esperanza, no techo) |
| Garantía QAOA p=1 | 0.6924 (inferior a GW — está en limitaciones) |
| Plataforma | Qulacs local (bucle) + emulador H2 en Nexus (validación) |
| Versiones | Python 3.12, pytket 2.18.1, qnexus 0.46.0 |
| Tope del emulador Nexus | 20 qubits |
| Renovables en Costa Rica | ~98% de la electricidad |
| ODS y metas | 7 (7.1, 7.2) · 9 (9.1, 9.5) · 13 (13.1) |
