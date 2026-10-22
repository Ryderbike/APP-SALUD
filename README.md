# Calma Nocturna

Una app web para dejar pasar las ganas de comer dulce, picotear o pedir delivery de noche, y para planificar y seguir tus rutinas de gimnasio en casa.

La idea es simple: las ganas suben y bajan como una ola. Si les das unos minutos y haces otra cosa mientras tanto, casi siempre pasan. La app te acompaña en ese rato.

## Qué hace

- **Botón "Tengo ganas ahora".** Eliges qué te pide el cuerpo (algo dulce, delivery o bajón), qué tan fuertes son las ganas del 1 al 10, cuánto te costaría el antojo y cuántos minutos quieres esperar (5, 10, 15 o 20).
- **Esfera del tiempo.** En el centro hay una esfera que se va llenando de luz mientras pasa el tiempo. Cada segundo llega una luciérnaga y el líquido sube. Se puede tocar: suena una nota, el líquido se mueve, y si mantienes el dedo al inhalar, la esfera se infla.
- **Respiración guiada.** Ritmo 4-2-6: inhalas 4 segundos, sostienes 2 y exhalas 6.
- **Tareas "ve y haz esto".** Ideas concretas una por una: lavarte los dientes, tomar un té, salir de la cocina, cerrar la app de delivery, lavarte la cara con agua fría.
- **Música de calma y lluvia.** Se generan en vivo con la Web Audio API, sin archivos de audio.
- **Cierre sin culpa.** Al final te pregunta cómo están las ganas ahora y te muestra cuánto bajaron. Puedes irte a dormir, pedir 5 minutos más o marcar que comiste igual.
- **Entrenar: planificador de rutinas.** Armas tus rutinas (lo ideal, 4 o 5 ejercicios) con series, repeticiones y kilos, y les asignas días de la semana. La app te dice qué toca hoy y te guía serie por serie: anotas lo que hiciste de verdad, descansas mientras la esfera se llena y pasas al siguiente ejercicio. Recuerda el último peso que usaste en cada ejercicio. Trae una lista de ejercicios con mancuernas, banca, bici estática, bicicleta y peso corporal, y puedes escribir los tuyos. No cuenta calorías.
- **Tus noches.** Calendario de los últimos 7 días (noches ganadas y días entrenados), noches ganadas, entrenamientos y plata ahorrada.

Todo se guarda solo en tu teléfono (`localStorage`). No hay cuentas ni servidor, y nada sale del dispositivo.

## Instalarla en el teléfono

Abre la página en el navegador del teléfono y:

- **iPhone (Safari):** Compartir → "Agregar a pantalla de inicio".
- **Android (Chrome):** menú ⋮ → "Instalar app" o "Agregar a pantalla principal".

Queda como una app con su ícono y funciona sin conexión.

## Estructura

```
index.html            la app completa (HTML, CSS y JS en un solo archivo)
manifest.webmanifest  nombre, colores e íconos para instalarla
sw.js                 service worker: la guarda para usarla sin conexión
_headers              cabeceras para Cloudflare Pages
icons/                íconos de la app
```

No hay paso de compilación ni dependencias.

## Correrla en tu computador

Cualquier servidor estático sirve:

```bash
python3 -m http.server 8080
# o
npx serve .
```

Luego abre http://localhost:8080.

## Publicarla en Cloudflare Pages

1. En el panel de Cloudflare entra a **Workers & Pages → Create → Pages → Connect to Git**.
2. Elige este repositorio.
3. Configuración del build:
   - Framework preset: **None**
   - Build command: *(vacío)*
   - Build output directory: `/`
4. **Save and Deploy.**

Cada push a `main` publica una versión nueva. Los pull requests reciben su propia URL de vista previa.

Cuando cambies archivos, sube el número de `VERSION` en `sw.js` para que los teléfonos que ya la instalaron descarguen lo nuevo.

## Cambiar las tareas

Las sugerencias están en `index.html`, en el objeto `TASKS`. Cada una tiene un título y una frase corta:

```js
["Lávate los dientes ahora.", "Con la boca a menta, lo dulce pierde casi todo el sabor."]
```

Hay listas para `dulce`, `delivery`, `bajon` y una `general` que se mezcla con todas.

## Cambiar la lista de ejercicios

Los ejercicios que aparecen al armar una rutina están en `index.html`, en `LIB`, agrupados por equipo. Los que están en el grupo "Cardio" se miden en minutos en vez de series. Las rutinas de ejemplo están en `SEED`.

## Aviso

Esta app es una ayuda para el día a día, no un tratamiento. Si la ansiedad o la relación con la comida te están afectando mucho, conversarlo con un profesional de salud ayuda.

## Licencia

MIT
