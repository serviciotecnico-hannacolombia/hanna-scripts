# hanna-scripts

Scripts de Tampermonkey para la intranet de Hanna Colombia, versionados en GitHub para que el equipo trabaje sobre el mismo código y todos reciban las actualizaciones automáticamente en su navegador.

## Scripts disponibles

Instala solo los que uses — cada uno vive en su propia página de la intranet y funciona de forma independiente.

| Script | Dónde funciona | Qué hace | Link de instalación |
|---|---|---|---|
| **Panel de Control Intranet Hanna** | `.../stecnico/item/*/diagnosis` | Autocompleta lecturas/soluciones del informe de diagnóstico, con lotes/vencimientos sincronizados desde Google Sheets. | [Instalar](https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/panel-hanna.user.js) |
| **QR Pedidos SGP** | `.../sgp/item/*` | Genera un QR (SVG) con los datos del pedido (RUT, cotización, OTST, remisión, factura), descargable en SVG/PNG. | [Instalar](https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/qr-pedidos-sgp.user.js) |
| **QR Órdenes de Trabajo** | `.../stecnico/item/*` | Genera un QR con el ID de la OT, fecha, NIT/cliente y correo de contacto; incluye versión lista para imprimir. | [Instalar](https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/qr-ordenes-trabajo.user.js) |
| **WhatsApp Pre-Ingreso** | `.../stecnico/pre_ingreso/item/*` | Detecta el/los celular(es) del contacto y muestra botones de WhatsApp con un mensaje predeterminado. | [Instalar](https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/whatsapp-preingreso.user.js) |
| **WhatsApp OT** | `.../stecnico/item/*` | Igual que el anterior pero para la página de la OT. | [Instalar](https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/whatsapp-ot.user.js) |
| **Lineamientos del Cliente** | `.../stecnico/item/N` (solo "Ver Detalle") | Detecta el NIT del cliente y muestra sus lineamientos especiales (por categoría) debajo de la tarjeta de Estado, leídos desde Google Sheets. | [Instalar](https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/lineamientos-cliente.user.js) |

## Instalación (una sola vez, por persona, por cada script)

1. Instala la extensión **Tampermonkey** en tu navegador.
2. Entra al link de instalación del script que quieras (tabla de arriba). Es un enlace **Raw** a GitHub.
3. Tampermonkey detecta que es un userscript y te ofrece instalarlo. Acepta.

A partir de ahí, Tampermonkey revisa esa URL cada cierto tiempo (configurable en *Tampermonkey → Settings → Update*) y si el `@version` del archivo cambió, se actualiza solo. Si quieres forzar el chequeo ya: *Tampermonkey Dashboard → Utilities → Check for userscript updates*.

## Los dos scripts de WhatsApp: configura tu nombre

**WhatsApp Pre-Ingreso** y **WhatsApp OT** insertan tu nombre en el mensaje predeterminado ("...hablas con FULANO del Servicio Técnico..."). Como el script es compartido por todo el equipo, ese nombre **ya no está escrito en el código**: cada quien lo configura una sola vez en su propio navegador.

- Busca el botón **⚙️** junto a los íconos de WhatsApp (abajo a la derecha de la página).
- Haz clic, escribe tu nombre y acepta. La página se recarga y desde ahí todos los mensajes que generes usan ese nombre.
- Si lo dejas vacío, el mensaje simplemente omite el nombre ("...hablas con el Servicio Técnico de Hanna Instruments...").
- El nombre se guarda en el navegador (no se sube a ningún lado), y **se comparte entre ambos scripts**: configúralo una vez y sirve para los dos.

## Flujo de trabajo colaborativo

- **`main`** es la rama "estable" — la que todo el mundo tiene instalada vía `@updateURL`. Todo lo que llega ahí se propaga solo a los navegadores.
- Para cambios grandes o que quieras probar antes de soltar a todos, crea una rama (`git checkout -b feature/nueva-cosa`), trabaja ahí, y cuando esté listo haces merge a `main` **y subes el `@version`** en el header del script (Tampermonkey solo detecta cambios si el número de versión sube).
- Si alguien quiere probar tu rama antes del merge, puede instalar apuntando su propio `@updateURL`/`@downloadURL` a esa rama en vez de `main`.

## Pasos para subir cambios a GitHub

```bash
# Desde esta carpeta (ya está enlazada al repo serviciotecnico-hannacolombia/hanna-scripts):
git remote add origin https://github.com/serviciotecnico-hannacolombia/hanna-scripts.git   # solo la primera vez
git branch -M main
git push -u origin main
```

En adelante basta con `git add -A && git commit -m "..." && git push`.

## Soluciones Estándar: panel de checkboxes 100% dinámico desde Google Sheets

Desde v14.0 (y con panel de checkboxes desde v14.2), el botón **"🧴 Elegir Soluciones Estándar…"** ya no tiene nada escrito en el código: la lista que abre se construye en vivo con lo que haya en un Google Sheet compartido. Como cada semana se abren soluciones nuevas (y hasta cambian de referencia), lo único que se mantiene fijo es el **parámetro** — el código, lote, vencimiento y hasta la descripción pueden cambiar todas las semanas sin tocar el script ni GitHub.

### 1. Crea el Sheet

Crea una hoja de cálculo con estas 5 columnas exactas, en este orden, con encabezado en la fila 1:

| codigo | lote | vencimiento | parametro | descripcion |
|---|---|---|---|---|
| HI7004-1L | 3201 | 04/2031 | pH | Solución buffer estándar de pH 4.01 ± 0.01 @ 25 °C (77 °F) |
| HI7007-1G | 2804 | 03/2031 | pH | Solución buffer estándar de pH 7.01 ± 0.01 @ 25 °C (77 °F) |
| HI7010-1L | 3241 | 04/2028 | pH | Solución buffer estándar de pH 10.01 ± 0.01 @ 25 °C (77 °F) |
| HI7030L | 1637 | 05/2030 | CE | Solución estándar de conductividad 12859 ± 50 uS/cm @ 25 °C (77 °F) |
| HI7031L/C | 2521 | 11/2030 | CE | Solución estándar de conductividad 1413 ± 5 uS/cm @ 25 °C (77 °F) |
| HI7033L | 2675 | 01/2029 | CE | Solución estándar de conductividad 84 ± 1 uS/cm @ 25 °C (77 °F) |
| HI7034L | 1890 | 07/2030 | CE | Solución estándar de conductividad 80000 ± 200 uS/cm @ 25 °C (77 °F) |
| HI7040L | S0069/24 | 07/2029 | OD | Cero Oxígeno Disuelto |
| HI93703-0 | T0001 | 01/2028 | FTU | Estándar 0 FTU |
| HI93703-10 | T0002 | 01/2028 | FTU | Estándar 10 FTU |
| HI93703-50 | T0003 | 01/2028 | FTU | Estándar 50 FTU |
| HI98703-11 | T0004 | 01/2028 | NTU | Kit Estándares NTU |

Notas importantes sobre esta tabla:

- **`codigo`** ya no tiene que coincidir con nada del script — puede ser cualquier referencia, y puede cambiar cada vez que abren una solución nueva.
- **`parametro`** es lo único que el script usa para agrupar la lista del panel (pH, CE, OD, FTU, NTU, o el que quieras escribir). Si agregas un parámetro nuevo (ej. "Cloro"), aparece solo como grupo nuevo en el panel, sin tocar código.
- **`descripcion`** es el texto que ve el técnico en cada checkbox del panel. Si la dejas vacía, se muestra el código.
- Puedes tener varias filas con el mismo parámetro (como las 4 de CE arriba, con distinto rango uS/mS): todas aparecen como opciones separadas dentro del mismo grupo, y el técnico elige la que realmente usó.
- Agregar o quitar filas del Sheet agrega o quita checkboxes del panel automáticamente — nunca hay que tocar `panel-hanna.user.js` por esto.

### 2. Publícalo como CSV

`Archivo → Compartir → Publicar en la web` → elige la hoja correcta → formato **CSV** → Publicar → copia el link. Esa es tu `SHEET_CSV_URL`.

### 3. Consigue el link normal de edición

Es la URL que usas siempre para abrir y editar el Sheet (la de `docs.google.com/spreadsheets/d/.../edit`). Esa es tu `SHEET_EDIT_URL`.

### 4. Pégalas en el script

En `panel-hanna.user.js`, busca:
```js
var SHEET_CSV_URL = 'PEGA_AQUI_URL_CSV_PUBLICADA';
var SHEET_EDIT_URL = 'PEGA_AQUI_URL_NORMAL_DEL_SHEET';
```
y reemplaza ambos placeholders. Sube el `@version`, commit y push.

### Cómo se comporta

- Al abrir la página, el panel carga primero lo que tenga en caché local (instantáneo) y en paralelo intenta refrescar desde el Sheet.
- Si no hay internet o el Sheet no responde, usa el último dato que alcanzó a descargar.
- El botón **"🧴 Elegir Soluciones Estándar…"** abre un panel con **checkboxes** agrupados por parámetro (no un desplegable): marca todas las que usaste y dale a **"➕ Cargar seleccionadas"**. Cada una cae en la primera fila vacía de la tabla — si ya había algo cargado, lo nuevo se agrega debajo sin borrarlo. Así arma cualquier combo (pH + CE + OD, etc.) en un solo paso.
- El panel se cierra solo y desmarca todo después de cargar, listo para la siguiente vez.
- El botón **"🔄 Recargar soluciones del Sheet"** fuerza una relectura del Sheet (y de la lista de checkboxes) sin recargar la página.
- Cada fila de la tabla que tenga algo (por el panel o escrita a mano) muestra su propio botón **✖** para borrar solo esa fila. El botón 🗑️ junto al panel borra toda la tabla de una vez.
- El botón ✏️ abre el Sheet directamente para editar.
- Cualquiera con permiso de edición en el Sheet puede agregar, quitar o cambiar una fila (código, lote, vencimiento, parámetro o descripción) y, en el siguiente refresh (automático o con el botón 🔄), todos los navegadores lo ven — sin tocar código ni GitHub.

### El panel de checkboxes, desde v16.14

Este mismo panel (usado tanto por Soluciones Estándar como por Mediciones Iniciales/Finales, ver abajo) tuvo dos mejoras pensadas para cuando la lista de checkboxes crece mucho:

- **Categorías plegadas por defecto**: antes, al abrir "Elegir…", se veían TODOS los checkboxes de TODAS las categorías de una vez. Ahora cada categoría (ej. "pH", "Conductividad") empieza plegada, mostrando solo su título con la cantidad de opciones entre paréntesis — un clic la despliega para marcar, otro clic la vuelve a plegar.
- **Buscador**: arriba de la lista hay un campo "🔍 Buscar...". Al escribir, se filtran en vivo los checkboxes que coinciden (por su texto o por el nombre de la categoría) y se despliegan automáticamente solo esas categorías; al borrar la búsqueda, cada categoría vuelve a quedar como la habías dejado (abierta o plegada). Nada de lo que ya hayas marcado se pierde al buscar, aunque quede oculto momentáneamente por el filtro.
- **El panel ahora flota** sobre la página en vez de empujarla hacia abajo al abrirse — se cierra solo si haces clic afuera o con la tecla Escape, además de con "Cancelar" o después de cargar tu selección.

## Mediciones Iniciales/Finales: panel de checkboxes 100% dinámico desde Google Sheets

Desde v15.0, "Mediciones Iniciales" y "Mediciones Finales" funcionan igual que Soluciones Estándar: ya no hay "recetas" fijas escritas en el código (`ph_temp_1dec`, `multi_completo`, etc.). En su lugar, cada punto de lectura individual (un pH, una conductividad, una temperatura...) vive como una fila en una pestaña del Sheet, y el técnico arma la combinación que necesite marcando checkboxes.

### 1. Crea la pestaña "lecturas" en el MISMO Sheet

En el mismo Google Sheet que ya usas para Soluciones, crea una pestaña nueva (ej. `lecturas`) con estas 5 columnas exactas, en este orden, con encabezado en la fila 1:

| categoria | etiqueta | valor | ayuda | tolerancia |
|---|---|---|---|---|
| pH | 7.01 pH (2 decimales) | 7.01 pH | 7.01 ± 0.01 pH @25°C | ±0.05 pH |
| pH | 4.01 pH (2 decimales) | 4.01 pH | 4.01 ± 0.01 pH @25°C | ±0.05 pH |
| Conductividad | 1413 uS/cm (F.S.) | 1413 uS/cm | 1413±5 uS/cm @25°C | ±2.0% F.S |
| Temperatura | 25.0°C | 25.0°C | 25.0 °C | ±0.7 °C |

Notas sobre esta tabla:

- **`categoria`** agrupa los checkboxes del panel (pH, Conductividad, Oxígeno, Temperatura, Fotometría y óptica, Absorbancia, Checkers, Turbidez, o la que quieras). Agregar una categoría nueva crea un grupo nuevo en el panel automáticamente.
- **`etiqueta`** es el texto que ve el técnico en el checkbox.
- **`valor` / `ayuda` / `tolerancia`** son los tres campos que se escriben en la fila de la tabla de Mediciones cuando se marca esa opción.
- Cada fila es un punto de lectura **individual** (no un combo armado). Si antes existía un combo tipo "pH + Conductividad + T°", ahora el técnico simplemente marca las 2 o 3 filas que necesita.

Se te entregó por chat una tabla de partida (`lecturas_propuesta.csv`) con las ~46 combinaciones que ya existían en el código anterior, ya separadas en puntos individuales — puedes pegarla directo en esta pestaña y ajustarla desde ahí.

### 2. Publícala como CSV y pega el link en el script

Igual que con Soluciones: `Archivo → Compartir → Publicar en la web` → elige la pestaña `lecturas` → formato **CSV** → Publicar → copia el link. En `panel-hanna.user.js`, busca:
```js
var SHEET_LECTURAS_CSV_URL = 'PEGA_AQUI_URL_CSV_LECTURAS';
```
y reemplaza el placeholder por ese link. Sube el `@version`, commit y push.

### Cómo se comporta

- Cada tabla (Mediciones Iniciales, Mediciones Finales) tiene su **propio** botón "🧪 Elegir Mediciones Iniciales…" / "🧪 Elegir Mediciones Finales…", con su propio panel de checkboxes agrupado por categoría — son dos paneles independientes que leen la misma pestaña `lecturas`, igual que hoy son dos tablas independientes.
- Marca las que necesites y dale a "➕ Cargar seleccionadas": cada una cae en la primera fila vacía de esa tabla, sin borrar lo que ya había cargado.
- Cada fila de Mediciones que tenga datos muestra su propio botón **✖** para borrarla; el 🗑️ junto al panel borra toda la tabla de una vez.
- El botón **"🔄 Recargar datos del Sheet"** ahora refresca **ambas** pestañas (Soluciones y Mediciones) en un solo clic.
- Cualquiera con permiso de edición puede agregar, quitar o cambiar filas de `lecturas` y, en el siguiente refresh, todos los navegadores lo ven — sin tocar código ni GitHub.

⚠️ **Pendiente de revisar en el Sheet**: la fila "Checker Cloro Total 1.50 ppm" quedó con el dato original incompleto (no tenía tolerancia definida en el script viejo). Complétala directamente en la pestaña `lecturas` cuando tengas el valor real — no hace falta tocar código.

### Marcador de resultado (✔ / ✘ / Inestable)

Desde v15.1, apenas el campo **"Referencia del equipo"** de una fila de Mediciones (Iniciales o Finales) tiene algo escrito, aparece un pequeño botón **●** justo al lado. Al hacer clic se abre un mini menú con 3 opciones:

- **✔ Correcto** (verde)
- **✘ Incorrecto** (rojo)
- **Inestable** (naranja)

Al elegir una, se agrega al final de lo que ya estaba escrito en ese campo (ej. `7.0 pH <b><FONT COLOR="green">✔</FONT></b>`), que es como el sistema de la intranet pinta esos íconos de color en el informe. Si cambias de opinión y eliges otra opción, la marca anterior se reemplaza — nunca quedan dos marcas juntas. Si borras el campo, el botón desaparece solo.

### Soporte para varios "Informe de Revisión" (hasta 5 por página)

Desde v16.3, **Mediciones Iniciales/Finales** funcionan igual de bien si activas un segundo, tercer... informe de Revisión en la misma página (antes solo funcionaba el primero). El sitio nombra los campos de cada Revisión como `mediciones_iniciales[N][fila][columna]` (confirmado inspeccionando un campo real: `mediciones_iniciales[2][1][1]`), así que el script detecta cuántas Revisiones hay activas ahora mismo y le pone su **propio** panel de checkboxes a cada una — eligen y cargan de forma totalmente independiente, sin mezclar datos entre Revisiones. Cuando hay más de una, el botón de cada panel se etiqueta "(Revisión 2)", "(Revisión 3)"... para que no haya confusión sobre cuál es cuál.

Desde v16.14, **Soluciones Estándar** también tiene este soporte: se confirmó con un campo real del Informe 2 (`soluciones_codigo[2][1]`) que sí trae el número de Revisión entre corchetes, igual que Mediciones — antes de eso el botón "🧴 Elegir Soluciones Estándar…" solo alcanzaba a aparecer en el primer Informe de la página, y en el Informe 2, 3, etc. no salía. Ahora cada Revisión tiene su propio botón y panel, sin mezclar datos entre tablas.

## Plantillas de "Diagnóstico Preliminar" por tipo de equipo (desde GitHub)

Desde v16.0 (y usando GitHub en vez de Drive desde v16.1), el bloque "Diagnóstico Preliminar" (Estado físico externo/interno, Descripción del procedimiento efectuado, Método de Verificación, Observaciones y recomendaciones) se puede llenar de una sola vez con un botón **"📋 Elegir plantilla de diagnóstico… → ➕ Cargar"**, según el tipo de equipo.

Desde v16.6, cargar una plantilla **se agrega** al final de lo que ya haya en cada campo (separado por una línea en blanco) — igual que Soluciones/Mediciones — así que se pueden **combinar varias plantillas** en la misma Revisión (por ejemplo, la del medidor + la de la sonda). Debajo del selector aparece un aviso tipo *"Se cargaron: Tester pH/ORP/CE (HI 9XXXX), Oxímetro portátil"* con el nombre de cada una que se haya cargado ahí, en orden. Antes de v16.6 el botón reemplazaba todo el contenido y preguntaba primero si ya había texto — eso ya no aplica.

Desde v16.15, el desplegable dejó de ser un `<select>` nativo y es el mismo combo-con-buscador de Soluciones/Mediciones: un botón que muestra la plantilla elegida (o el texto de siempre) y que, al hacer clic, abre un panel flotante con un buscador arriba y la lista de tipos de equipo debajo. Sigue funcionando igual (elige y dale "➕ Cargar"), pero ahora se puede filtrar por nombre a medida que crezca la lista de plantillas.

Desde v16.16, esa lista **ya NO está escrita en el código** (ver v16.6-16.15 más abajo para el historial): sale en vivo de una pestaña del mismo Google Sheet que ya usan Soluciones y Mediciones, agrupada por categoría (Tester, Multiparámetro, Sonda, Oxímetro, o la que uses). Agregar un tipo de equipo nuevo es: subir el `.txt` a GitHub + agregar una fila al Sheet — **cero cambios de código**. El detalle completo está en "Agregar un equipo nuevo" más abajo.

> **Por qué GitHub y no Google Drive:** se probó primero con links de descarga directa de Drive, pero Drive no permite que un script de OTRO sitio (`intranet.hannacolombia.com`) descargue el archivo — el navegador lo bloquea por CORS, aunque el archivo sea público. GitHub (`raw.githubusercontent.com`) sí lo permite, y ya es la infraestructura que usan los `.user.js` de este mismo repo.

### Cómo funciona por dentro

- Cada tipo de equipo es un archivo `.txt` dentro de la carpeta `plantillas-diagnostico/` de este mismo repo, con 5 secciones marcadas así:
  ```
  ###ESTADO_FISICO_EXTERNO###
  ...texto...

  ###ESTADO_FISICO_INTERNO###
  ...texto...

  ###DE ACUERDO CON LOS RESULTADOS OBTENIDOS ¿SE REQUIEREN ACCIONES CORRECTIVAS O PREVENTIVAS?###
  ...texto... (esto cae en "Descripción del procedimiento efectuado")

  ###MÉTODO_DE_VERIIFCACIÓN###
  ...texto...

  ###OBSERVACIONES###
  ...texto...
  ```
- El script descarga cada `.txt` directo desde `raw.githubusercontent.com/.../main/plantillas-diagnostico/archivo.txt` — funciona en cualquier navegador, sin instalar nada ni compartir/publicar nada aparte.
- Como una misma página puede tener hasta 5 "Revisión" (Revisión 1, 2, 3...) cada una con su propio Diagnóstico Preliminar, el botón se inyecta **una vez por cada Revisión que actives**, y cada una carga sus propias plantillas de forma independiente — cargar una no toca las demás Revisiones.
- Puedes cargar la misma plantilla más de una vez si lo necesitas (por ejemplo, para repetir un bloque) — no hay advertencia ni bloqueo, simplemente se agrega otra vez debajo.
- Nota: como este repo es **público**, estas plantillas quedan visibles para cualquiera (igual que los scripts). Son procedimientos técnicos genéricos, no datos de clientes — si en algún momento contienen algo sensible, avisa antes de subirlo así.

### Agregar un equipo nuevo (guía fácil, sin necesitar saber programar)

No hace falta instalar nada ni usar la terminal — todo se hace desde la página de GitHub en el navegador. Son 3 partes.

#### Parte 1: Prepara el archivo `.txt` de la plantilla

1. Descarga (o abre) uno de los `.txt` que ya existen en `plantillas-diagnostico/` como punto de partida — es más fácil editar uno que empezar de cero.
2. Debe tener EXACTAMENTE estas 5 líneas de marcador, cada una en su propia línea, seguidas del texto de esa sección:
   ```
   ###ESTADO_FISICO_EXTERNO###
   (aquí el texto para "Estado físico externo")

   ###ESTADO_FISICO_INTERNO###
   (aquí el texto para "Estado físico interno")

   ###DE ACUERDO CON LOS RESULTADOS OBTENIDOS ¿SE REQUIEREN ACCIONES CORRECTIVAS O PREVENTIVAS?###
   (aquí el texto para "Descripción del procedimiento efectuado")

   ###MÉTODO_DE_VERIIFCACIÓN###
   (aquí el texto para "Método de Verificación")

   ###OBSERVACIONES###
   (aquí el texto para "Observaciones y recomendaciones")
   ```
   ⚠️ Los marcadores `###...###` deben quedar escritos tal cual (mismas mayúsculas, mismos acentos) — si los cambias, esa sección no se va a reconocer.
3. Guarda el archivo con un nombre corto, sin espacios ni tildes, terminado en `.txt` (ejemplo: `medidor-hi-9829.txt`).

#### Parte 2: Sube el `.txt` a GitHub

1. Entra a **github.com/serviciotecnico-hannacolombia/hanna-scripts** con la cuenta del equipo (`serviciotecnico.hannacolombia@gmail.com`).
2. Entra a la carpeta **`plantillas-diagnostico`**.
3. Clic en el botón verde **"Add file"** (arriba a la derecha de la lista de archivos) → **"Upload files"**.
4. Arrastra tu `.txt` a la página (o clic en "choose your files" y búscalo).
5. Abajo, en "Commit changes", escribe algo corto como *"Agregar plantilla medidor HI 9829"* y dale clic al botón verde **"Commit changes"**.

#### Parte 3: Agrega la fila en el Sheet (desde v16.16, sin tocar código)

1. Abre el Sheet (botón "✏️ Abrir Sheet de lotes" del panel, o el link de siempre) y ve a la pestaña **`plantillas`**.
2. Agrega una fila nueva con estas 3 columnas:

   | categoria | etiqueta | archivo |
   |---|---|---|
   | Medidor | 🧪 Medidor HI 9829 | medidor-hi-9829.txt |

   - **`categoria`**: agrupa el buscador (puedes reusar una que ya exista — Tester, Multiparámetro, Sonda, Oxímetro — o inventar una nueva).
   - **`etiqueta`**: el texto que va a ver el técnico (el emoji lo escribes tú directamente en la celda).
   - **`archivo`**: el nombre EXACTO del `.txt` que subiste en la Parte 2 (mayúsculas, guiones, todo igual) — solo el nombre, no la ruta completa.
3. Listo. En el panel, el técnico le da a "🔄 Recargar datos del Sheet" (o recarga la página) y ya aparece la plantilla nueva agrupada bajo su categoría.

No hace falta subir versión ni tocar `panel-hanna.user.js` para esto — solo para cambios de comportamiento del script.

#### Para probarlo

Recarga la página de la intranet (o dale "🔄 Recargar datos del Sheet" en el panel). Abre un informe, en "Diagnóstico Preliminar" debería aparecer tu categoría/plantilla nueva en el buscador — selecciónala, dale "➕ Cargar" y revisa que los 5 campos se llenen bien.

Si algo no te queda claro, mándame el `.txt` con las 5 secciones y el nombre/categoría que quieres que aparezca, y yo agrego la fila.

### La pestaña "plantillas" del Sheet (desde v16.16)

Igual que Soluciones/Mediciones, esta lista ya no vive en el código: sale de una pestaña **`plantillas`** del mismo Google Sheet, con estas columnas exactas, en este orden, con encabezado en la fila 1:
```
categoria	etiqueta	archivo
```
- Cada fila es un tipo de equipo. `archivo` es solo el nombre del `.txt` en `plantillas-diagnostico/` (el script arma la URL completa solo).
- Publícala igual que las otras dos pestañas: **Archivo → Compartir → Publicar en la web → elige la pestaña "plantillas" → formato CSV → copia el link**, y pégalo en `SHEET_PLANTILLAS_CSV_URL` dentro del script (junto a `SHEET_CSV_URL` y `SHEET_LECTURAS_CSV_URL`, sección "0c" del código).
- Si el Sheet no responde (sin internet, o la pestaña no se publicó), el panel usa la última copia guardada en caché del navegador; y si tampoco hay caché, arranca con las 5 plantillas originales como respaldo, para que el técnico nunca se quede sin nada que elegir.
- El botón "🔄 Recargar datos del Sheet" del panel también refresca esta lista, junto con Soluciones y Mediciones.

### Si el sitio cambia el "id" de algún campo

Los 5 campos se ubican por el patrón de su `id` HTML (ej. `edit-diagnostico-preliminar-estado-fisico-externo-1`, donde `1` es el número de Revisión). Si la intranet cambia esos ids, hay que actualizar el arreglo `CAMPOS_DIAGNOSTICO` en el script — inspecciona el campo con clic derecho → Inspeccionar y avísale a Brayan el nuevo `id`.

### Resaltado en vivo de HTML (desde v16.7)

Los 5 campos de Diagnóstico Preliminar guardan las etiquetas HTML (`<b>`, `<mark style="...">`) que el sistema interpreta al generar el informe — pero mientras se escribe, el campo solo muestra texto plano, así que un `>` faltante o una etiqueta sin cerrar no se nota hasta que el informe ya salió mal formateado.

Desde v16.7, el script pinta esas etiquetas directamente encima del campo (una capa visual: lo que se guarda no cambia) y agrega, justo debajo, un aviso en rojo si detecta algo roto — por ejemplo:

> ⚠️ Falta el ">" que cierra una etiqueta (línea 3)

Esto corre en vivo mientras se escribe o se carga una plantilla, en los 5 campos de cada Revisión. Si algo se ve desalineado (el texto que aparece no coincide con donde está el cursor), avísale a Brayan — la capa de resaltado copia el tamaño de letra/relleno del campo real, pero cada Revisión nueva que agregue la intranet vale la pena confirmarla una vez.

Desde v16.10, la misma validación también corre en:
- **Mediciones Iniciales/Finales**: los 3 campos de cada fila (valor, ayuda, tolerancia) — el marcador de resultado (✔ / ✘ / Inestable) que agrega el botón "●" es HTML (`<b><FONT COLOR="...">...</FONT></b>`), y ahí es donde más se nota si algo queda mal escrito.
- **Soluciones Estándar**: los 4 campos de cada fila (código, lote, vencimiento, descripción).

Estos campos son `<input>` angostos (no `<textarea>` como Diagnóstico Preliminar), así que desde v16.11 NO muestran el texto coloreado por dentro — un campo tan angosto como "Referencia del equipo" lo cortaba feo contra el borde. En vez de eso, si hay algo roto el campo se marca con un **contorno rojo** y aparece el mismo aviso flotante debajo explicando qué falta; el campo real no se toca en nada más (nada de texto transparente ni capa encima), así que no hay riesgo de desalinear el cursor.

Herramienta aparte para revisar el `.txt` de una plantilla completa antes de subirla a GitHub (mismo resaltado + valida que el nombre de cada sección `###...###` sea uno de los que espera el script): pídele a Brayan el link del "Validador de Plantillas".

Desde v16.13, los 5 campos de Diagnóstico Preliminar (solo esos — no Mediciones ni Soluciones) también muestran un **contador de líneas** a la izquierda, como en un editor de código, con el mismo fondo blanco de siempre (no se agregó ningún panel de color nuevo) y una línea muy tenue separándolo del texto. El contador numera por línea del texto (separada por saltos de línea reales), igual que dice el aviso de error ("línea N").

Desde v16.17, el número de cada línea queda pegado a su fila real aunque el párrafo sea largo y se envuelva en varias filas visuales dentro del campo (antes, en v16.13-v16.16, el contador asumía que cada línea ocupaba exactamente una fila, así que después del primer párrafo largo los números quedaban cada vez más atrasados respecto al texto). Ahora la posición de cada número se calcula midiendo dónde envuelve realmente el texto, no contando líneas de forma uniforme.

## Lineamientos del Cliente: aviso por NIT desde Google Sheets

En la página **"Ver Detalle"** de una OT (`.../stecnico/item/12345`, sin ningún sufijo — no aparece en la pestaña "Diagnóstico" ni en las demás pestañas), el script busca el NIT del cliente en la página y, si tiene lineamientos especiales registrados, muestra una tarjeta amarilla justo debajo de la tarjeta de "Estado" con el resumen, agrupado por categoría. Si el cliente no tiene nada registrado, no aparece ninguna tarjeta — no estorba en el resto de las OT.

### El Sheet: pestaña "lineamientos"

Es una pestaña nueva en el mismo Google Sheet que ya usan Soluciones/Mediciones ("Patrones de ST"), publicada igual que las otras (Archivo → Compartir → Publicar en la Web). Columnas:

| NIT | Razon Social | Categoria | Lineamiento |
|---|---|---|---|
| 901107537 | CONSTRUCCIONES & SERVICIOS INTEGRALES | Ingreso en Intranet | No cotizar despacho tras el diagnóstico |
| *(vacío)* | *(vacío)* | Facturación y Despacho | Facturar solo a nombre de la razón social principal |
| *(vacío)* | *(vacío)* | Facturación y Despacho | Avisar un día antes del despacho |
| 900999999 | OTRO CLIENTE SAS | Comunicación con el Cliente | Todo por correo, nunca llamar |

**Una fila por lineamiento.** El NIT y la Razón Social solo se escriben en la **primera fila** de cada cliente — en las filas siguientes de ese mismo cliente se dejan en blanco (el script entiende "en blanco" como "mismo cliente que la fila de arriba"). En cuanto aparece un NIT nuevo en la columna, se asume que empieza otro cliente.

Las categorías que el script conoce y en qué orden las muestra (sin importar el orden de las filas en el Sheet):

1. Ingreso en Intranet
2. Diagnóstico
3. Equipos Operativos
4. Equipos No Operativos
5. Facturación y Despacho
6. Comunicación con el Cliente

Si escribes una categoría que no es exactamente una de esas 6 (por un typo, o porque agregaste una nueva), el lineamiento **no se pierde** — igual se muestra, solo que al final de la tarjeta, después de las 6 conocidas.

### Agregar/quitar un lineamiento

Solo edita la pestaña "lineamientos" del Sheet — agrega o borra filas ahí. No hay que tocar el script para esto; el cambio se ve reflejado la próxima vez que alguien abra esa OT (el script no cachea entre visitas, siempre pide el dato más reciente al Sheet, y solo usa la copia guardada en el navegador si el Sheet no responde).

### Cómo encuentra el NIT en la página

Usa el mismo método que ya prueba **QR Órdenes de Trabajo**: busca un elemento chico de la página que contenga la palabra "NIT" seguida de números, en vez de depender de un `id` fijo (la intranet no le pone uno a ese bloque). Si el sitio cambia por completo cómo muestra el NIT del cliente y el script deja de encontrarlo, avísale a Brayan con una captura de esa sección de "Ver Detalle".

### Renombrar etiquetas de la tabla de "Ver Detalle"

Desde v1.1.0, el mismo script también cambia el texto de un par de etiquetas de la tabla (columna izquierda) en TODAS las OTST, sin tocar nada del lado del servidor:

- "E-mails del cliente para copia de notificaciones" → **"E-mails de Copia"**
- "Última Atención Aplicaciones Cliente" → **"Ultima visita IA"**

Esto es puramente visual (solo cambia lo que se ve en el navegador de quien tenga el script instalado; no renombra nada en la base de datos ni en reportes). Para agregar o cambiar un renombre, edita el objeto `RENOMBRES_ETIQUETAS` en `lineamientos-cliente.user.js` (clave = texto exacto actual de la etiqueta, valor = texto nuevo) y sube el `@version`.

## Cuando hagas un cambio

1. Edita el archivo `.user.js` del script que quieras cambiar.
2. Sube el número de `@version` **de ese archivo** (ej: `2.0.0` → `2.1.0`). Tampermonkey solo detecta la actualización si el número sube; los demás scripts no se ven afectados.
3. `git add -A && git commit -m "Descripción del cambio" && git push`
4. En un rato (o forzando el check manual desde *Tampermonkey Dashboard → Utilities → Check for userscript updates*), todos los navegadores con ese script instalado se actualizan solos.