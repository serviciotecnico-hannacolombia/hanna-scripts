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

## Lotes y vencimientos: fuente única en Google Sheets

Desde v13.1, los lotes y fechas de vencimiento de los estándares/buffers **ya no se escriben a mano en cada navegador**. Se leen automáticamente desde un Google Sheet compartido, así todo el equipo ve siempre el mismo dato.

### 1. Crea el Sheet

Crea una hoja de cálculo con estas 4 columnas exactas, en este orden, con encabezado en la fila 1:

| codigo | lote | vencimiento | descripcion |
|---|---|---|---|
| HI7004L | 2459 | 11/2030 | Buffer pH 4.01 |
| HI7007L | 2804 | 01/2031 | Buffer pH 7.01 |
| HI7010L | 3231 | 04/2028 | Buffer pH 10.01 |
| HI7031L | 2521 | 11/2030 | Conductividad 1413 uS/cm |
| HI7033L | 3448 | 05/2029 | Conductividad 84 uS/cm |
| HI7030L | 1637 | 05/2030 | Conductividad 12880 uS/cm |
| HI7040L | S0089-24 | 09/2029 | Cero Oxígeno Disuelto |
| HI93703-0 | T0001 | 2028-01 | Estándar 0 FTU |
| HI93703-10 | T0002 | 2028-01 | Estándar 10 FTU |
| HI93703-50 | T0003 | 2028-01 | Estándar 50 FTU |
| HI98703-11 | T0004 | 2028-01 | Kit Estándares NTU |

(esos son los códigos que el script ya reconoce — puedes agregar más filas con otros códigos si más adelante agregas más estándares, pero **no cambies los códigos existentes** sin actualizar también el script). La columna `descripcion` es opcional: si la dejas vacía en una fila, el script usa la descripción por defecto que trae escrita.

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
- Si no hay internet o el Sheet no responde, usa el último dato que alcanzó a descargar (o el valor por defecto si nunca ha conectado).
- El botón **"🔄 Recargar lotes del Sheet"** en el panel fuerza una relectura sin recargar la página.
- Los botones ⚙️ junto a cada grupo de soluciones ahora abren el Sheet directamente para editar, en vez de la cadena de `prompt()` de antes.
- Cualquiera con permiso de edición en el Sheet puede actualizar un lote/vencimiento/descripción y, en el siguiente refresh (automático o con el botón 🔄), todos los navegadores lo ven — sin tocar código ni GitHub.

## Cuando hagas un cambio

1. Edita el archivo `.user.js` del script que quieras cambiar.
2. Sube el número de `@version` **de ese archivo** (ej: `2.0.0` → `2.1.0`). Tampermonkey solo detecta la actualización si el número sube; los demás scripts no se ven afectados.
3. `git add -A && git commit -m "Descripción del cambio" && git push`
4. En un rato (o forzando el check manual desde *Tampermonkey Dashboard → Utilities → Check for userscript updates*), todos los navegadores con ese script instalado se actualizan solos.