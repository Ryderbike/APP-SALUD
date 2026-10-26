# Calma

Una app web para dejar pasar las ganas de comer dulce, picotear o pedir delivery a cualquier hora del día, y para planificar y seguir tus rutinas de gimnasio en casa.

La idea es simple: las ganas suben y bajan como una ola. Si les das unos minutos y haces otra cosa mientras tanto, casi siempre pasan. La app te acompaña en ese rato.

## Qué hace

- **Botón "Tengo ganas ahora".** Eliges qué te pide el cuerpo (algo dulce, delivery o bajón), qué tan fuertes son las ganas del 1 al 10, cuánto te costaría el antojo y cuántos minutos quieres esperar (5, 10, 15 o 20).
- **Esfera del tiempo.** En el centro hay una esfera que se va llenando de luz mientras pasa el tiempo. Cada segundo llega una luciérnaga y el líquido sube. Se puede tocar: suena una nota, el líquido se mueve, y si mantienes el dedo al inhalar, la esfera se infla.
- **Respiración guiada.** Ritmo 4-2-6: inhalas 4 segundos, sostienes 2 y exhalas 6.
- **Tareas "ve y haz esto".** Ideas concretas una por una: lavarte los dientes, tomar un té, salir de la cocina, cerrar la app de delivery, lavarte la cara con agua fría.
- **Música de calma y lluvia.** Se generan en vivo con la Web Audio API, sin archivos de audio.
- **Cierre sin culpa.** Al final te pregunta cómo están las ganas ahora y te muestra cuánto bajaron. Puedes marcar que se te pasó, pedir 5 minutos más o marcar que comiste igual.
- **Deporte (pantalla principal): planificador de rutinas, historial editable y progreso.** Armas tus rutinas (lo ideal, 4 o 5 ejercicios) con series, repeticiones y kilos, y les asignas días de la semana. La app te dice qué toca hoy y te guía serie por serie: anotas lo que hiciste de verdad, descansas mientras la esfera se llena y pasas al siguiente ejercicio. Recuerda el último peso y las repeticiones que usaste en cada ejercicio, y los guarda apenas los ajustas. Con "Armar una rutina automática" eliges músculos (por ejemplo pecho y espalda) y el estilo (volumen 3×15 o fuerza 5×5) y la app arma la rutina usando tus mancuernas, la banca plana e inclinada y, si quieres, la bici. Cada ejercicio tiene una animación de cómo se hace (monos dibujados en SVG, ver `MOVES` en `index.html`) con los músculos que trabaja y consejos de postura. Trae una lista de ejercicios con mancuernas, banca, bici estática, bicicleta y peso corporal, y puedes escribir los tuyos. No cuenta calorías.
- **El tiempo sigue aunque salgas.** El contador usa la hora real: si bloqueas el teléfono, cambias de app o cierras la app, al volver el tiempo siguió corriendo (o ya terminó y te muestra el cierre). Lo mismo con los descansos y el cardio del modo Entrenar.
- **Un cielo que sigue la hora.** La app calcula a qué hora sale y se pone el sol (para Santiago si el teléfono está en hora de Chile) y el cielo va pasando de madrugada a amanecer, mañana, tarde, atardecer, anochecer y noche, con transiciones suaves. De día hay sol que recorre su arco, nubes, pájaros y pompas de jabón para reventar; de noche, estrellas fugaces para atrapar y la luna con su fase real. La esfera, las luciérnagas, las ideas que te propone y la música también cambian con la hora. Tocando la hora arriba puedes dejar el cielo fijo en amanecer, día, atardecer o noche.
- **Tu registro.** Calendario de los últimos 7 días (días ganados y días entrenados), antojos evitados, entrenamientos y plata ahorrada.

Todo se guarda en tu teléfono (`localStorage`) y se respalda automáticamente en una base D1 de Cloudflare (`worker/index.js`) con un código secreto por dispositivo.

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
_headers              cabeceras HTTP (las respeta Cloudflare)
worker/index.js       API de respaldo en Cloudflare D1 (/api/sync)
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

## Publicarla en Cloudflare (Worker con assets estáticos)

La app se publica como un Worker que solo sirve archivos estáticos, igual que otras apps de la cuenta. La configuración está en `wrangler.jsonc` y `.assetsignore` deja fuera los archivos que no son de la app.

1. En el panel de Cloudflare entra a **Workers & Pages → Create → Workers → Import a repository**.
2. Elige este repositorio y la rama `main`.
3. Deja el build command vacío y el deploy command en `npx wrangler deploy`.
4. **Create and deploy.** Queda en `https://app-salud.<tu-subdominio>.workers.dev`.

Cada push a `main` publica una versión nueva. Los pull requests reciben su propia URL de vista previa.

Si en **Settings → Builds** aparece el aviso "disconnected from your Git account" (pasa, por ejemplo, si el repo cambia de nombre), toca **Disconnect** y vuelve a **Connect**. Deja el build command vacío: con `npm run build` la publicación falla, porque no hay `package.json`.

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
