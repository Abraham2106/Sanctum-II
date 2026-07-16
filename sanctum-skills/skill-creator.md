---
id: skill-creator
name: "Skill Creator"
description: "Diseña o mejora skills reusables de Sanctum-II mediante contexto del proyecto, investigación web, redacción especializada y quality gate. Invocala con /skill-creator o /skill-creator --update."
tools: []
---
Diseña una skill que otro agente pueda ejecutar sin reconstruir decisiones esenciales del dominio.

## Principios de autoría

- Separa el comportamiento reusable de la identidad de un agente. No inventes avatar, modelo, permisos ni triggers.
- Distingue las capacidades usadas por el mesh para investigar de las tools que la skill necesitará cuando sea invocada. No copies `rag_query` o `web_search` al frontmatter solo porque fueron usadas durante la autoría.
- Usa el RAG para descubrir convenciones, restricciones, vocabulario y artefactos reales del proyecto. Si no hay evidencia local, indícalo internamente y no la inventes.
- Usa la investigación web para cubrir vacíos con documentación oficial, papers y fuentes vigentes. Convierte los hallazgos en reglas operativas, no en una bibliografía decorativa.
- Rechaza frases vacías como “usa buenas prácticas”, “sé preciso” o “genera código de calidad” cuando no definan verificaciones observables.

## Contrato de la skill

- Usa un `id` kebab-case que coincida con el nombre del archivo.
- Escribe un nombre humano y una descripción recuperable que explique capacidad, contexto de invocación y límites relevantes.
- Declara solo `rag_query`, `web_search`, `create_note` o `append_to_note`, y únicamente cuando el flujo de ejecución realmente las necesite.
- Incluye `{{user_prompt}}`; incluye `{{rag_context}}` con `rag_query` y `{{web_context}}` con `web_search`.

## Cuerpo operativo

Redacta en imperativo y organiza el cuerpo con headings. Incluye, cuando sean pertinentes:

1. Rol, objetivo y alcance exacto.
2. Entradas que debe extraer del pedido y decisiones que debe tomar.
3. Proceso interno que no debe narrarse al usuario.
4. Reglas técnicas específicas del dominio, con APIs, estándares, compatibilidades y criterios de selección.
5. Contrato de salida con estructura, formato y nivel de detalle verificables.
6. Validaciones antes de entregar el resultado.
7. Manejo de ambigüedad, datos insuficientes, errores y alternativas inseguras o incompatibles.
8. Límites explícitos: qué no debe hacer ni asumir.

Mantén la skill densa y escaneable. La completitud proviene de decisiones útiles, no de repetir el brief ni de añadir relleno.

El mesh valida y guarda únicamente borradores que superen el quality gate. El modo `--update` debe considerar la skill existente y conservar una copia histórica antes de reemplazarla.

Pedido del usuario:
{{user_prompt}}
