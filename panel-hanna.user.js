// ==UserScript==
// @name         Panel de Control Intranet Hanna
// @namespace    http://tampermonkey.net/
// @version      16.16
// @description  Panel completo: Mediciones/Soluciones/Plantillas de Diagnóstico 100% dinámicas desde Google Sheets, marcador de resultado (✔/✘/Inestable), y plantillas de Diagnóstico Preliminar por tipo de equipo desde GitHub
// @author       Brayan Galeano
// @match        https://intranet.hannacolombia.com/stecnico/item/*/diagnosis
// @grant        none
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/panel-hanna.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/panel-hanna.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Debe coincidir siempre con @version del header de arriba.
    var APP_VERSION = '16.16';

    var columnasPorFilaLecturas = 3;

    // ==========================================
    // 0. SOLUCIONES ESTÁNDAR DESDE GOOGLE SHEETS (100% dinámico)
    // ==========================================
    // La hoja debe tener, en este orden, las columnas:
    //   codigo | lote | vencimiento | parametro | descripcion
    // (con encabezado en la fila 1). A diferencia de antes, el "codigo" YA NO
    // tiene que coincidir con nada escrito en el script: cualquier fila que
    // pongas aquí aparece automáticamente en el menú "Autocompletar Soluciones
    // Estándar", agrupada por el valor de "parametro" (ej. pH, CE, OD, FTU,
    // NTU...). Puedes agregar, quitar o cambiar filas (incluso el código/
    // referencia) cada semana sin tocar el código del script — lo único que
    // debe mantenerse es el nombre del parámetro, para que la fila caiga en el
    // grupo correcto del menú. La columna "descripcion" es la que se usa como
    // texto de cada opción del menú; si la dejas vacía, se usa el código.
    //
    // Cómo obtener las dos URLs de abajo:
    //  1. SHEET_CSV_URL: en el Sheet -> Archivo -> Compartir -> Publicar en la web
    //     -> elige la hoja correcta -> formato CSV -> copia el link.
    //  2. SHEET_EDIT_URL: la URL normal del Sheet (la que usas para editarlo),
    //     la que abre el botón "✏️ Editar en Sheets" del panel.

    var SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT2t_Y1keodEQiK9Iv4C8PoYmkAe-dFDgVek2z4fAr9IACCV-XDzFvB8jnrBB6J5t4uUwgpwn2W9CSz/pub?gid=0&single=true&output=csv';
    var SHEET_EDIT_URL = 'https://docs.google.com/spreadsheets/d/1AzJX5B-myRtumple68r7ZXGpE7Xc3nLtkddG5i9rD98/edit?gid=0#gid=0';

    var CACHE_KEY = 'hanna_sheet_cache_v1';
    // Lista de filas tal cual están en el Sheet (en orden), no un diccionario:
    // [{ codigo: "HI7004-1L", lote: "3201", venc: "04/2031", parametro: "pH", desc: "Solución buffer..." }, ...]
    var datosSheet = [];
    var sheetUltimaActualizacion = null;

    // Parser CSV (soporta campos entre comillas con comas Y saltos de línea
    // dentro, y comillas escapadas "" dentro de un campo). A diferencia de la
    // versión anterior, NO corta el texto por saltos de línea antes de mirar
    // las comillas: si una celda de Google Sheets tiene un salto de línea
    // interno (ej. una descripción en 2 líneas), ese salto queda DENTRO del
    // mismo campo en vez de partir la fila en dos (lo que antes generaba una
    // fila fantasma en el grupo "Sin parámetro").
    function parseCSV(texto) {
        var filas = [];
        var actual = [];
        var campo = '';
        var dentroComillas = false;
        var limpio = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        for (var i = 0; i < limpio.length; i++) {
            var c = limpio[i];
            if (dentroComillas) {
                if (c === '"') {
                    if (limpio[i + 1] === '"') { campo += '"'; i++; } // comilla escapada ""
                    else { dentroComillas = false; }
                } else {
                    campo += c;
                }
            } else if (c === '"') {
                dentroComillas = true;
            } else if (c === ',') {
                actual.push(campo); campo = '';
            } else if (c === '\n') {
                actual.push(campo); campo = '';
                filas.push(actual); actual = [];
            } else {
                campo += c;
            }
        }
        if (campo !== '' || actual.length > 0) { actual.push(campo); filas.push(actual); }

        return filas.slice(1) // salta encabezado
            .map(function(campos) {
                // Un salto de línea que sobrevivió dentro de un campo (ej. una
                // descripción en 2 líneas) se convierte en un espacio, para no
                // meter saltos de línea crudos en los <input> del formulario.
                return campos.map(function(v) { return v.replace(/\s*\n\s*/g, ' ').trim(); });
            })
            .filter(function(campos) { return campos.some(function(v) { return v !== ''; }); });
    }

    function aplicarFilasSheet(filas) {
        var nuevo = [];
        filas.forEach(function(campos) {
            var codigo = (campos[0] || '').trim();
            var lote = campos[1], venc = campos[2], parametro = campos[3], desc = campos[4];
            if (!codigo) return; // fila vacía o sin código: se ignora
            nuevo.push({
                codigo: codigo,
                lote: lote || '',
                venc: venc || '',
                parametro: (parametro || '').trim() || 'Sin parámetro',
                desc: desc || ''
            });
        });
        datosSheet = nuevo;
    }

    function guardarCache(texto) {
        try {
            localStorage.setItem(CACHE_KEY, texto);
            localStorage.setItem(CACHE_KEY + '_ts', new Date().toISOString());
        } catch (e) { /* localStorage no disponible, seguimos sin cache */ }
    }

    function cargarCache() {
        try {
            var texto = localStorage.getItem(CACHE_KEY);
            var ts = localStorage.getItem(CACHE_KEY + '_ts');
            if (texto) {
                aplicarFilasSheet(parseCSV(texto));
                sheetUltimaActualizacion = ts ? new Date(ts) : null;
            }
        } catch (e) { /* nada que cargar */ }
    }

    function cargarDatosSheet(callback) {
        if (!SHEET_CSV_URL || SHEET_CSV_URL.indexOf('PEGA_AQUI') === 0) {
            if (callback) callback(false);
            return;
        }
        fetch(SHEET_CSV_URL, { cache: 'no-store' })
            .then(function(r) { return r.text(); })
            .then(function(texto) {
                aplicarFilasSheet(parseCSV(texto));
                sheetUltimaActualizacion = new Date();
                guardarCache(texto);
                if (callback) callback(true);
            })
            .catch(function(err) {
                console.warn('[Panel Hanna] No se pudo leer el Sheet de lotes, usando último dato conocido / valores por defecto.', err);
                if (callback) callback(false);
            });
    }

    function abrirEditorSheet() {
        if (!SHEET_EDIT_URL || SHEET_EDIT_URL.indexOf('PEGA_AQUI') === 0) {
            alert('Todavía no se configuró la URL del Sheet de lotes en el script.');
            return;
        }
        window.open(SHEET_EDIT_URL, '_blank');
    }

    // ==========================================
    // 0b. MEDICIONES (LECTURAS) DESDE GOOGLE SHEETS (100% dinámico)
    // ==========================================
    // Misma idea que las Soluciones Estándar, pero para "Mediciones Iniciales"
    // y "Mediciones Finales". Es una pestaña NUEVA ("lecturas") dentro del
    // MISMO Google Sheet, con estas columnas exactas, en este orden, con
    // encabezado en la fila 1:
    //   categoria | etiqueta | valor | ayuda | tolerancia
    // Cada fila es UN punto de lectura individual (no una "receta" completa
    // como antes). El técnico marca en el panel los puntos que usó y se van
    // acumulando en la primera fila vacía de la tabla — igual que Soluciones.

    var SHEET_LECTURAS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT2t_Y1keodEQiK9Iv4C8PoYmkAe-dFDgVek2z4fAr9IACCV-XDzFvB8jnrBB6J5t4uUwgpwn2W9CSz/pub?gid=419179050&single=true&output=csv';
    var CACHE_KEY_LECTURAS = 'hanna_sheet_cache_lecturas_v1';
    // [{ categoria: "pH", etiqueta: "7.01 pH (2 decimales)", valor: "7.01 pH", ayuda: "...", tolerancia: "±0.05 pH" }, ...]
    var datosLecturas = [];
    var sheetLecturasUltimaActualizacion = null;

    function aplicarFilasLecturas(filas) {
        var nuevo = [];
        filas.forEach(function(campos) {
            var categoria = (campos[0] || '').trim();
            var etiqueta = campos[1], valor = campos[2], ayuda = campos[3], tolerancia = campos[4];
            if (!etiqueta && !valor) return; // fila vacía: se ignora
            nuevo.push({
                categoria: categoria || 'Sin categoría',
                etiqueta: etiqueta || (valor || ''),
                valor: valor || '',
                ayuda: ayuda || '',
                tolerancia: tolerancia || ''
            });
        });
        datosLecturas = nuevo;
    }

    function guardarCacheLecturas(texto) {
        try {
            localStorage.setItem(CACHE_KEY_LECTURAS, texto);
            localStorage.setItem(CACHE_KEY_LECTURAS + '_ts', new Date().toISOString());
        } catch (e) { /* localStorage no disponible, seguimos sin cache */ }
    }

    function cargarCacheLecturas() {
        try {
            var texto = localStorage.getItem(CACHE_KEY_LECTURAS);
            var ts = localStorage.getItem(CACHE_KEY_LECTURAS + '_ts');
            if (texto) {
                aplicarFilasLecturas(parseCSV(texto));
                sheetLecturasUltimaActualizacion = ts ? new Date(ts) : null;
            }
        } catch (e) { /* nada que cargar */ }
    }

    function cargarDatosLecturas(callback) {
        if (!SHEET_LECTURAS_CSV_URL || SHEET_LECTURAS_CSV_URL.indexOf('PEGA_AQUI') === 0) {
            if (callback) callback(false);
            return;
        }
        fetch(SHEET_LECTURAS_CSV_URL, { cache: 'no-store' })
            .then(function(r) { return r.text(); })
            .then(function(texto) {
                aplicarFilasLecturas(parseCSV(texto));
                sheetLecturasUltimaActualizacion = new Date();
                guardarCacheLecturas(texto);
                if (callback) callback(true);
            })
            .catch(function(err) {
                console.warn('[Panel Hanna] No se pudo leer el Sheet de lecturas, usando último dato conocido / caché.', err);
                if (callback) callback(false);
            });
    }

    // ==========================================
    // 0c. PLANTILLAS DE DIAGNÓSTICO PRELIMINAR DESDE GOOGLE SHEETS
    // ==========================================
    // Misma idea que Soluciones/Mediciones: una pestaña NUEVA ("plantillas")
    // dentro del MISMO Google Sheet, con estas columnas exactas, en este
    // orden, con encabezado en la fila 1:
    //   categoria | etiqueta | archivo
    // "archivo" es solo el NOMBRE del .txt dentro de la carpeta
    // plantillas-diagnostico/ de este mismo repo de GitHub (no la URL
    // completa — el script la arma solo con GITHUB_PLANTILLAS_BASE, que se
    // define más abajo junto a esa carpeta). Así, agregar un tipo de equipo
    // nuevo ya NO requiere tocar este archivo: solo subir el .txt a GitHub y
    // agregar una fila aquí con su nombre bonito y el nombre del archivo.

    var SHEET_PLANTILLAS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT2t_Y1keodEQiK9Iv4C8PoYmkAe-dFDgVek2z4fAr9IACCV-XDzFvB8jnrBB6J5t4uUwgpwn2W9CSz/pub?gid=979403274&single=true&output=csv';
    var CACHE_KEY_PLANTILLAS = 'hanna_sheet_cache_plantillas_v1';
    // [{ categoria: "Tester", etiqueta: "🧪 Tester pH/ORP/CE (HI 9XXXX)", archivo: "tester-ph-orp-ce.txt" }, ...]
    var datosPlantillasSheet = [];
    var sheetPlantillasUltimaActualizacion = null;

    function aplicarFilasPlantillas(filas) {
        var nuevo = [];
        filas.forEach(function(campos) {
            var categoria = (campos[0] || '').trim();
            var etiqueta = campos[1], archivo = campos[2];
            if (!etiqueta || !archivo) return; // fila incompleta: se ignora
            nuevo.push({
                categoria: categoria || 'Sin categoría',
                etiqueta: etiqueta,
                archivo: archivo.trim()
            });
        });
        datosPlantillasSheet = nuevo;
    }

    function guardarCachePlantillas(texto) {
        try {
            localStorage.setItem(CACHE_KEY_PLANTILLAS, texto);
            localStorage.setItem(CACHE_KEY_PLANTILLAS + '_ts', new Date().toISOString());
        } catch (e) { /* localStorage no disponible, seguimos sin cache */ }
    }

    function cargarCachePlantillas() {
        try {
            var texto = localStorage.getItem(CACHE_KEY_PLANTILLAS);
            var ts = localStorage.getItem(CACHE_KEY_PLANTILLAS + '_ts');
            if (texto) {
                aplicarFilasPlantillas(parseCSV(texto));
                sheetPlantillasUltimaActualizacion = ts ? new Date(ts) : null;
            }
        } catch (e) { /* nada que cargar */ }
    }

    function cargarDatosPlantillasSheet(callback) {
        if (!SHEET_PLANTILLAS_CSV_URL || SHEET_PLANTILLAS_CSV_URL.indexOf('PEGA_AQUI') === 0) {
            if (callback) callback(false);
            return;
        }
        fetch(SHEET_PLANTILLAS_CSV_URL, { cache: 'no-store' })
            .then(function(r) { return r.text(); })
            .then(function(texto) {
                aplicarFilasPlantillas(parseCSV(texto));
                sheetPlantillasUltimaActualizacion = new Date();
                guardarCachePlantillas(texto);
                if (callback) callback(true);
            })
            .catch(function(err) {
                console.warn('[Panel Hanna] No se pudo leer el Sheet de plantillas, usando último dato conocido / caché.', err);
                if (callback) callback(false);
            });
    }

    // ==========================================
    // 1. BANCO DE DATOS
    // ==========================================
    // Tanto las "Soluciones Estándar" como las "Mediciones Iniciales/Finales"
    // ya NO se definen aquí: se construyen en vivo desde datosSheet y
    // datosLecturas (ver Sección 3, construirOpcionesSolucionesDesdeSheet()
    // y construirOpcionesLecturasDesdeSheet()).

    // ==========================================
    // 2. FUNCIONES DE AUTOMATIZACIÓN
    // ==========================================

    // Prefijo real (atributo "name") de los campos de "Mediciones Finales" en la página.
    // Es una suposición basada en el patrón "mediciones_iniciales" que ya usa el sitio;
    // si al probar sale la alerta de "No se encontraron campos", inspecciona un campo de
    // esa tabla (clic derecho → Inspeccionar) y avísale a Brayan el nombre real para
    // cambiar esta única línea.
    var PREFIJO_MEDICIONES_FINALES = 'mediciones_finales';
    var PREFIJO_MEDICIONES_INICIALES = 'mediciones_iniciales';
    var PREFIJO_SOLUCIONES = 'soluciones_codigo';

    function borrarTablaMediciones(prefijoNombre) {
        var inputs = document.querySelectorAll('input[name^="' + prefijoNombre + '"]');
        for (var i = columnasPorFilaLecturas; i < inputs.length; i++) {
            inputs[i].value = '';
            inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
            inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    // El prefijo puede venir dado (ya con el "[N]" de su Revisión); si no,
    // se usa el prefijo genérico (compatibilidad con el formato antiguo).
    function borrarLecturas(prefijoNombre) { borrarTablaMediciones(prefijoNombre || PREFIJO_MEDICIONES_INICIALES); }
    function borrarMedicionesFinales(prefijoNombre) { borrarTablaMediciones(prefijoNombre || PREFIJO_MEDICIONES_FINALES); }

    // Agrega UNA lectura (valor, ayuda, tolerancia) en la primera fila vacía
    // de la tabla de Mediciones indicada, sin borrar lo que ya esté lleno —
    // igual patrón que agregarSolucionSecuencial, pero respetando el mismo
    // "inicio" (columnasPorFilaLecturas) que ya usaba el código anterior para
    // saltar la primera fila de la tabla.
    var COLUMNAS_POR_LECTURA = 3; // valor, ayuda, tolerancia

    function agregarLecturaSecuencial(prefijoNombre, datosFila) {
        var inputs = document.querySelectorAll('input[name^="' + prefijoNombre + '"]');
        if (inputs.length === 0) return alert('No se encontraron campos para "' + prefijoNombre + '".');

        var offset = columnasPorFilaLecturas;
        var totalFilas = Math.floor((inputs.length - offset) / COLUMNAS_POR_LECTURA);
        for (var fila = 0; fila < totalFilas; fila++) {
            var base = offset + fila * COLUMNAS_POR_LECTURA;
            if (!inputs[base].value) {
                for (var c = 0; c < COLUMNAS_POR_LECTURA && c < datosFila.length; c++) {
                    inputs[base + c].value = datosFila[c];
                    dispararEventos(inputs[base + c]);
                }
                return;
            }
        }
        alert('Ya no hay espacio libre en esta tabla de Mediciones. Borra alguna fila antes de agregar otra.');
    }

    // Borra solo los 3 campos de UNA fila de Mediciones (valor, ayuda,
    // tolerancia), identificada por el índice de su primer campo.
    function borrarFilaLectura(prefijoNombre, base) {
        var inputs = document.querySelectorAll('input[name^="' + prefijoNombre + '"]');
        for (var c = 0; c < COLUMNAS_POR_LECTURA; c++) {
            if (inputs[base + c]) {
                inputs[base + c].value = '';
                dispararEventos(inputs[base + c]);
            }
        }
    }

    // Agrega, junto a cada fila de una tabla de Mediciones que tenga al menos
    // un campo lleno, un botón "✖" para borrar solo esa fila (mismo patrón
    // que inyectarBotonesLimpiarFila para Soluciones).
    function inyectarBotonesLimpiarFilaLecturas(prefijoNombre) {
        var inputs = document.querySelectorAll('input[name^="' + prefijoNombre + '"]');
        var offset = columnasPorFilaLecturas;
        var totalFilas = Math.floor((inputs.length - offset) / COLUMNAS_POR_LECTURA);

        for (var fila = 0; fila < totalFilas; fila++) {
            var base = offset + fila * COLUMNAS_POR_LECTURA;
            var inputsFila = [];
            for (var c = 0; c < COLUMNAS_POR_LECTURA; c++) inputsFila.push(inputs[base + c]);

            var ultimoInput = inputsFila[COLUMNAS_POR_LECTURA - 1];
            if (!ultimoInput || ultimoInput.dataset.hannaBotonFilaLectura) continue; // ya tiene botón
            ultimoInput.dataset.hannaBotonFilaLectura = '1';

            (function(baseFila, inputsFila) {
                var boton = document.createElement('button');
                boton.type = 'button';
                boton.innerText = '✖';
                boton.title = 'Borrar esta fila de Mediciones';
                boton.style.marginLeft = '6px';
                boton.style.padding = '2px 7px';
                boton.style.fontSize = '11px';
                boton.style.lineHeight = '1.4';
                boton.style.border = '1px solid #dc3545';
                boton.style.borderRadius = '4px';
                boton.style.backgroundColor = '#fff';
                boton.style.color = '#dc3545';
                boton.style.cursor = 'pointer';
                boton.style.display = 'none';

                function actualizarVisibilidad() {
                    var tieneDatos = inputsFila.some(function(inp) { return inp.value.trim() !== ''; });
                    boton.style.display = tieneDatos ? 'inline-block' : 'none';
                }

                boton.onclick = function() {
                    borrarFilaLectura(prefijoNombre, baseFila);
                    actualizarVisibilidad();
                };

                inputsFila.forEach(function(inp) {
                    inp.addEventListener('input', actualizarVisibilidad);
                });

                ultimoInput.insertAdjacentElement('afterend', boton);
                actualizarVisibilidad();
            })(base, inputsFila);
        }
    }

    // ------------------------------------------
    // Marcador de resultado (✔ / ✘ / Inestable) en el campo "Referencia del
    // equipo" (primer campo de cada fila de Mediciones). Un pequeño botón
    // "●" aparece junto al campo apenas tiene texto, y abre un popover con
    // las 3 opciones. Elegir una reemplaza cualquier marca anterior (nunca
    // deja dos marcas encimadas) y la agrega al final de lo ya escrito.
    // ------------------------------------------
    var MARCADORES_ESTADO = [
        { etiqueta: '✔ Correcto', color: '#28a745', html: '<b><FONT COLOR="green">✔</FONT></b>' },
        { etiqueta: '✘ Incorrecto', color: '#dc3545', html: '<b><FONT COLOR="red">✘</FONT></b>' },
        { etiqueta: 'Inestable', color: '#fd7e14', html: '<b><FONT COLOR="orange">Inestable</FONT></b>' }
    ];

    // Reconoce cualquiera de las 3 marcas (con o sin coma final, por si algún
    // técnico la escribió a mano antes) al final del texto, para quitarla
    // antes de poner la nueva.
    var REGEX_MARCADOR_ESTADO_FINAL = /\s*<b><FONT COLOR="(?:green|red|orange)">(?:✔|✘|Inestable)<\/FONT><\/b>\s*,?\s*$/i;

    function quitarMarcadorEstado(valor) {
        return (valor || '').replace(REGEX_MARCADOR_ESTADO_FINAL, '');
    }

    function aplicarMarcadorEstado(input, marcador) {
        var base = quitarMarcadorEstado(input.value).trim();
        input.value = base + (base ? ' ' : '') + marcador.html;
        dispararEventos(input);
    }

    // Todos los popovers de estado abiertos, para poder cerrarlos con un
    // solo listener de clic global (en vez de uno por fila).
    var popoversEstadoActivos = [];
    document.addEventListener('click', function(e) {
        popoversEstadoActivos.forEach(function(popover) {
            if (popover.style.display !== 'none' && !popover.contains(e.target)) {
                popover.style.display = 'none';
            }
        });
    });

    // Agrega, junto al campo "Referencia del equipo" de cada fila de una
    // tabla de Mediciones, un pequeño botón "●" que abre un mini menú con
    // ✔ / ✘ / Inestable. Al elegir una opción, se agrega al final de lo que
    // el técnico ya escribió en ese campo (reemplazando cualquier marca
    // anterior).
    function inyectarBotonesEstadoLecturas(prefijoNombre) {
        var inputs = document.querySelectorAll('input[name^="' + prefijoNombre + '"]');
        var offset = columnasPorFilaLecturas;
        var totalFilas = Math.floor((inputs.length - offset) / COLUMNAS_POR_LECTURA);

        for (var fila = 0; fila < totalFilas; fila++) {
            var base = offset + fila * COLUMNAS_POR_LECTURA;
            var inputValor = inputs[base];
            if (!inputValor || inputValor.dataset.hannaBotonEstado) continue; // ya tiene botón
            inputValor.dataset.hannaBotonEstado = '1';

            // El marcador de resultado (✔/✘/Inestable) que agrega
            // aplicarMarcadorEstado() es HTML (<b><FONT COLOR="...">...</FONT></b>),
            // así que estos 3 campos de la fila también reciben el resaltado
            // en vivo para detectar una etiqueta mal escrita.
            for (var colResaltado = 0; colResaltado < COLUMNAS_POR_LECTURA; colResaltado++) {
                envolverConResaltadoHTML(inputs[base + colResaltado]);
            }

            (function(inputValor) {
                var envoltorio = document.createElement('span');
                envoltorio.style.position = 'relative';
                envoltorio.style.display = 'inline-block';

                var boton = document.createElement('button');
                boton.type = 'button';
                boton.innerText = '●';
                boton.title = 'Marcar resultado (✔ / ✘ / Inestable)';
                boton.style.marginLeft = '6px';
                boton.style.padding = '0 4px';
                boton.style.fontSize = '14px';
                boton.style.lineHeight = '1.6';
                boton.style.border = 'none';
                boton.style.backgroundColor = 'transparent';
                boton.style.color = '#6c757d';
                boton.style.cursor = 'pointer';
                boton.style.display = 'none';
                boton.style.verticalAlign = 'middle';

                var popover = document.createElement('div');
                popover.style.display = 'none';
                popover.style.flexDirection = 'column';
                popover.style.position = 'absolute';
                popover.style.top = '22px';
                popover.style.left = '0';
                popover.style.zIndex = '9999';
                popover.style.backgroundColor = '#fff';
                popover.style.border = '1px solid #dee2e6';
                popover.style.borderRadius = '6px';
                popover.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                popover.style.padding = '4px';
                popover.style.whiteSpace = 'nowrap';
                popover.style.fontFamily = 'Arial, sans-serif';
                popoversEstadoActivos.push(popover);

                MARCADORES_ESTADO.forEach(function(marcador) {
                    var opcion = document.createElement('button');
                    opcion.type = 'button';
                    opcion.innerText = marcador.etiqueta;
                    opcion.style.display = 'block';
                    opcion.style.width = '100%';
                    opcion.style.border = 'none';
                    opcion.style.background = 'none';
                    opcion.style.color = marcador.color;
                    opcion.style.fontWeight = 'bold';
                    opcion.style.fontSize = '12px';
                    opcion.style.textAlign = 'left';
                    opcion.style.padding = '4px 8px';
                    opcion.style.cursor = 'pointer';
                    opcion.style.borderRadius = '4px';
                    opcion.onmouseenter = function() { opcion.style.backgroundColor = '#f8f9fa'; };
                    opcion.onmouseleave = function() { opcion.style.backgroundColor = 'transparent'; };
                    opcion.onclick = function() {
                        aplicarMarcadorEstado(inputValor, marcador);
                        popover.style.display = 'none';
                    };
                    popover.appendChild(opcion);
                });

                function actualizarVisibilidad() {
                    var tieneTexto = inputValor.value.trim() !== '';
                    boton.style.display = tieneTexto ? 'inline-block' : 'none';
                    if (!tieneTexto) popover.style.display = 'none';
                }

                boton.onclick = function(e) {
                    e.stopPropagation();
                    popover.style.display = (popover.style.display === 'none') ? 'flex' : 'none';
                };

                inputValor.addEventListener('input', actualizarVisibilidad);

                inputValor.insertAdjacentElement('afterend', envoltorio);
                envoltorio.appendChild(boton);
                envoltorio.appendChild(popover);
                actualizarVisibilidad();
            })(inputValor);
        }
    }

    // Agrega UNA solución (código, lote, vencimiento, descripción) en la
    // primera fila vacía de la tabla, SIN borrar lo que ya esté lleno. Así el
    // técnico arma cualquier combo (pH + CE + OD, etc.) eligiendo del menú una
    // solución a la vez, en vez de un combo prearmado en el código.
    var COLUMNAS_POR_SOLUCION = 4; // código, lote, vencimiento, descripción

    // OJO: a diferencia de Mediciones (donde código/lote/vencimiento/desc.
    // SÍ comparten un mismo prefijo de "name" con un índice de Revisión,
    // confirmado con datos reales: "mediciones_iniciales[2][1][1]"), en
    // Soluciones Estándar cada COLUMNA es un campo con su propio nombre —
    // solo "Código" empieza con "soluciones_codigo" (confirmado con datos
    // reales: "soluciones_codigo[1][1]", "soluciones_codigo[1][2]" son dos
    // valores apilados de la MISMA columna "Código", no dos columnas
    // distintas). Por eso el selector tiene que ser más amplio: cualquier
    // input dentro de una tabla cuyo "name" contenga "soluciones" en algún
    // lado, para agarrar también Lote/Vencimiento/Descripción aunque no se
    // llamen "soluciones_codigo". No se sabe (todavía) si esta sección se
    // repite por Revisión igual que Mediciones, así que por ahora sigue
    // siendo un único panel para toda la página, como en v16.1 y antes.
    // "alcance" es la tabla de Soluciones Estándar de UNA Revisión puntual
    // (o el documento completo, en el caso raro de una página vieja sin
    // Revisiones). Antes esto siempre buscaba en TODO el documento, lo cual
    // solo servía mientras hubiera una única tabla de Soluciones en toda la
    // página — con varias Revisiones cada una con su propia tabla, había que
    // acotar la búsqueda a la tabla correcta (ver inyectarPanelesSoluciones).
    function obtenerInputsSoluciones(alcance) {
        var raiz = alcance || document;
        var inputs = raiz.querySelectorAll('table input[name*="soluciones"], input[name^="' + PREFIJO_SOLUCIONES + '"]');
        if (inputs.length === 0) inputs = raiz.querySelectorAll('input[type="text"]');
        return inputs;
    }

    function dispararEventos(input) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function agregarSolucionSecuencial(datosFila, alcance) {
        var inputs = obtenerInputsSoluciones(alcance);
        if (inputs.length === 0) return alert('No se encontraron campos de soluciones.');

        var totalFilas = Math.floor(inputs.length / COLUMNAS_POR_SOLUCION);
        for (var fila = 0; fila < totalFilas; fila++) {
            var base = fila * COLUMNAS_POR_SOLUCION;
            if (!inputs[base].value) {
                for (var c = 0; c < COLUMNAS_POR_SOLUCION && c < datosFila.length; c++) {
                    inputs[base + c].value = datosFila[c];
                    dispararEventos(inputs[base + c]);
                }
                return;
            }
        }
        alert('Ya no hay espacio libre en la tabla de Soluciones Estándar. Borra alguna fila antes de agregar otra.');
    }

    function borrarSolucionesSecuencial(alcance) {
        var inputs = obtenerInputsSoluciones(alcance);
        for (var i = 0; i < inputs.length; i++) {
            inputs[i].value = '';
            dispararEventos(inputs[i]);
        }
    }

    // Borra solo los 4 campos de UNA fila (código, lote, vencimiento,
    // descripción), identificada por el índice de su primer campo.
    function borrarFilaSolucion(base, alcance) {
        var inputs = obtenerInputsSoluciones(alcance);
        for (var c = 0; c < COLUMNAS_POR_SOLUCION; c++) {
            if (inputs[base + c]) {
                inputs[base + c].value = '';
                dispararEventos(inputs[base + c]);
            }
        }
    }

    // Agrega, junto a cada fila de la tabla de Soluciones Estándar que tenga
    // al menos un campo lleno, un pequeño botón "✖" para borrar solo esa
    // fila. El botón aparece/desaparece solo según si la fila tiene datos
    // (ya sea porque el técnico la llenó a mano o por el menú de arriba).
    function inyectarBotonesLimpiarFila(alcance) {
        var inputs = obtenerInputsSoluciones(alcance);
        var totalFilas = Math.floor(inputs.length / COLUMNAS_POR_SOLUCION);

        for (var fila = 0; fila < totalFilas; fila++) {
            var base = fila * COLUMNAS_POR_SOLUCION;
            var inputsFila = [];
            for (var c = 0; c < COLUMNAS_POR_SOLUCION; c++) inputsFila.push(inputs[base + c]);

            var ultimoInput = inputsFila[COLUMNAS_POR_SOLUCION - 1];
            if (!ultimoInput || ultimoInput.dataset.hannaBotonFila) continue; // ya tiene botón
            ultimoInput.dataset.hannaBotonFila = '1';

            // Los 4 campos de Soluciones también pueden llevar HTML escrito
            // a mano (igual que en Diagnóstico Preliminar), así que reciben
            // el mismo resaltado en vivo.
            inputsFila.forEach(function(inp) { envolverConResaltadoHTML(inp); });

            (function(baseFila, inputsFila) {
                var boton = document.createElement('button');
                boton.type = 'button';
                boton.innerText = '✖';
                boton.title = 'Borrar esta fila de Soluciones Estándar';
                boton.style.marginLeft = '6px';
                boton.style.padding = '2px 7px';
                boton.style.fontSize = '11px';
                boton.style.lineHeight = '1.4';
                boton.style.border = '1px solid #dc3545';
                boton.style.borderRadius = '4px';
                boton.style.backgroundColor = '#fff';
                boton.style.color = '#dc3545';
                boton.style.cursor = 'pointer';
                boton.style.display = 'none';

                function actualizarVisibilidad() {
                    var tieneDatos = inputsFila.some(function(inp) { return inp.value.trim() !== ''; });
                    boton.style.display = tieneDatos ? 'inline-block' : 'none';
                }

                boton.onclick = function() {
                    borrarFilaSolucion(baseFila, alcance);
                    actualizarVisibilidad();
                };

                inputsFila.forEach(function(inp) {
                    inp.addEventListener('input', actualizarVisibilidad);
                });

                ultimoInput.insertAdjacentElement('afterend', boton);
                actualizarVisibilidad();
            })(base, inputsFila);
        }
    }

    // ==========================================
    // 3. INTERFAZ: SELECTORES DISCRETOS JUNTO A CADA TABLA
    // ==========================================
    // En vez de un panel flotante gigante, cada tabla del formulario (Mediciones
    // Iniciales, Mediciones Finales, Soluciones Estándar) recibe un <select> chiquito
    // justo encima suyo. Eliges la opción y se llena esa tabla — nada se despliega.
    // Como el formulario es dinámico (las tablas aparecen después de elegir el "Tipo
    // de Informe"), un MutationObserver reintenta insertar los selectores cada vez
    // que el DOM cambia, hasta lograrlo.

    // Construye las opciones del panel de Mediciones (Iniciales/Finales) en
    // vivo, a partir de lo que haya AHORA MISMO en el Sheet (datosLecturas).
    // Un grupo por cada valor distinto de "categoria", en el orden en que
    // aparecen las filas en el Sheet. Igual criterio que Soluciones: cada
    // fila es un punto de lectura individual que el técnico marca si lo usó.
    function construirOpcionesLecturasDesdeSheet() {
        var grupos = {};
        var orden = [];
        datosLecturas.forEach(function(fila, indice) {
            var categoria = fila.categoria || 'Sin categoría';
            if (!grupos[categoria]) { grupos[categoria] = []; orden.push(categoria); }
            grupos[categoria].push({
                clave: String(indice),
                etiqueta: '🧪 ' + fila.etiqueta
            });
        });
        return orden.map(function(categoria) {
            return { categoria: categoria, items: grupos[categoria] };
        });
    }

    // Construye las opciones del menú "Autocompletar Soluciones Estándar"
    // en vivo, a partir de lo que haya AHORA MISMO en el Sheet (datosSheet).
    // Un grupo (optgroup) por cada valor distinto de "parametro", en el orden
    // en que aparecen las filas en el Sheet. Cada fila es una opción propia:
    // no se arma ningún combo en el código, así que agregar/quitar/cambiar
    // filas en el Sheet cambia el menú automáticamente, sin tocar el script.
    function construirOpcionesSolucionesDesdeSheet() {
        var grupos = {};
        var orden = [];
        datosSheet.forEach(function(fila, indice) {
            var parametro = fila.parametro || 'Sin parámetro';
            if (!grupos[parametro]) { grupos[parametro] = []; orden.push(parametro); }
            grupos[parametro].push({
                clave: String(indice),
                etiqueta: '🧴 ' + (fila.desc || fila.codigo)
            });
        });
        return orden.map(function(parametro) {
            return { categoria: parametro, items: grupos[parametro] };
        });
    }

    function crearBotonIcono(icono, titulo, colorBorde, accion) {
        var b = document.createElement('button');
        b.type = 'button';
        b.innerText = icono;
        b.title = titulo;
        b.style.padding = '4px 8px';
        b.style.fontSize = '12px';
        b.style.border = '1px solid ' + colorBorde;
        b.style.borderRadius = '4px';
        b.style.backgroundColor = '#fff';
        b.style.cursor = 'pointer';
        b.onclick = accion;
        return b;
    }

    function anclarAntesDeTabla(inputReferencia, elementoNuevo) {
        if (!inputReferencia) return false;
        var contenedor = inputReferencia.closest('table') || inputReferencia.parentElement;
        if (!contenedor || !contenedor.parentNode) return false;
        // Evita insertar dos veces si ya está anclado (por ejemplo tras un re-render parcial).
        if (contenedor.previousElementSibling && contenedor.previousElementSibling.className === 'hanna-panel-inline') {
            return true;
        }
        contenedor.parentNode.insertBefore(elementoNuevo, contenedor);
        return true;
    }

    // Antes eran banderas simples (true/false, una sola vez para toda la
    // página). Ahora son objetos { "1": true, "2": true, ... } porque una
    // misma página puede tener hasta 5 "Informe de Revisión" y cada uno
    // necesita su propio panel — igual que ya pasaba con Diagnóstico
    // Preliminar.
    var controlesInyectados = { iniciales: {}, finales: {}, soluciones: {}, badge: false };
    var panelesSolucionesRef = []; // { poblar } de cada panel de checkboxes de Soluciones Estándar (uno por Revisión), para poder refrescarlos
    var panelesLecturasIniRef = []; // { poblar } de cada panel de checkboxes de Mediciones Iniciales
    var panelesLecturasFinRef = []; // { poblar } de cada panel de checkboxes de Mediciones Finales

    // Vuelve a construir la lista de TODOS los paneles de Soluciones Estándar
    // (uno por Revisión) con lo último que haya en datosSheet. Se llama tras
    // cada carga/recarga del Sheet (si un panel todavía no existe en el DOM,
    // no hace nada: cuando se inyecte usará datosSheet ya actualizado).
    function refrescarMenuSoluciones() {
        var opciones = construirOpcionesSolucionesDesdeSheet();
        panelesSolucionesRef.forEach(function(panel) { panel.poblar(opciones); });
    }

    // Igual que refrescarMenuSoluciones, pero para los paneles de Mediciones
    // (Iniciales y Finales) de cada Revisión, con lo último que haya en
    // datosLecturas.
    function refrescarMenuLecturas() {
        var opciones = construirOpcionesLecturasDesdeSheet();
        panelesLecturasIniRef.forEach(function(panel) { panel.poblar(opciones); });
        panelesLecturasFinRef.forEach(function(panel) { panel.poblar(opciones); });
    }

    // Encuentra, para un campo tipo "mediciones_iniciales", todas las
    // Revisiones presentes AHORA MISMO en la página y el prefijo exacto de
    // "name" que hay que usar para cada una.
    //
    // El sitio nombra los campos de una Revisión "N" como
    // "mediciones_iniciales[N][fila][columna]" (confirmado inspeccionando un
    // campo real de la Revisión 2: name="mediciones_iniciales[2][1][1]"). Si
    // por algún motivo un campo no trae ese "[N]" (formato antiguo, sin
    // Revisiones), se lo cuenta como Revisión "1" usando el prefijo plano,
    // para no dejar de funcionar en ese caso.
    //
    // Devuelve un objeto { "1": "mediciones_iniciales[1]", "2": "mediciones_iniciales[2]", ... }
    // (o { "1": "mediciones_iniciales" } si no hay corchetes de Revisión).
    function extraerPrefijosPorRevision(prefijoBase) {
        var mapa = {};
        var regexRevision = new RegExp('^(' + prefijoBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\[(\\d+)\\])');
        document.querySelectorAll('input[name^="' + prefijoBase + '"]').forEach(function(input) {
            var m = input.name.match(regexRevision);
            if (m) {
                mapa[m[2]] = m[1];
            } else if (!mapa['1']) {
                mapa['1'] = prefijoBase;
            }
        });
        return mapa;
    }

    // Para el buscador del panel de checklist: compara sin importar
    // mayúsculas/minúsculas ni tildes ("vencimiento" debe encontrar
    // "Vencimiento" y "verificación").
    function normalizarTextoBusqueda(s) {
        return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    // Panel de checkboxes para elegir varios ítems de una lista de una vez
    // (en vez de un <select> que se aplica al primer clic). El técnico marca
    // los que usó, agrupados por categoría/parámetro, y los carga todos
    // juntos con un botón — cada uno cae en la primera fila vacía de su
    // tabla, así que si ya había algo cargado, lo nuevo se agrega debajo sin
    // borrarlo. Se reutiliza tanto para Soluciones Estándar como para
    // Mediciones Iniciales/Finales.
    //
    // Cada categoría inicia PLEGADA (solo el título, sin sus casillas) y se
    // despliega con un clic; además hay un buscador arriba de la lista que,
    // al escribir, filtra los ítems de todas las categorías y despliega
    // automáticamente solo las que tienen resultados — al borrar el texto,
    // cada categoría vuelve a quedar como el técnico la había dejado.
    //
    // El panel de checkboxes "flota" (position:absolute) en vez de ocupar
    // espacio en el flujo normal de la página: como "barra" es un elemento
    // propio del script (no una celda/columna de la intranet cuyo tamaño
    // dependa de layout ajeno), darle position:relative y sacar el panel del
    // flujo con position:absolute es seguro — no repite el problema de v16.11
    // (ese sí era sobre campos REALES del formulario, con su propio CSS).
    // Así, abrir/cerrar el panel ya no empuja hacia abajo la tabla ni el
    // resto de la página.
    function crearPanelChecklist(opcionesIniciales, colorBorde, textoBotonAbrir, onCargarSeleccionadas) {
        var barra = document.createElement('div');
        barra.style.position = 'relative';
        barra.style.display = 'flex';
        barra.style.flexDirection = 'column';
        barra.style.margin = '6px 0';
        barra.style.fontFamily = 'Arial, sans-serif';
        barra.className = 'hanna-panel-inline';

        var filaBotones = document.createElement('div');
        filaBotones.style.display = 'flex';
        filaBotones.style.alignItems = 'center';
        filaBotones.style.gap = '6px';

        var botonAbrir = document.createElement('button');
        botonAbrir.type = 'button';
        botonAbrir.innerText = textoBotonAbrir;
        botonAbrir.style.fontSize = '12px';
        botonAbrir.style.padding = '5px 10px';
        botonAbrir.style.borderRadius = '4px';
        botonAbrir.style.border = '1px solid ' + colorBorde;
        botonAbrir.style.color = '#155724';
        botonAbrir.style.backgroundColor = '#fff';
        botonAbrir.style.cursor = 'pointer';
        filaBotones.appendChild(botonAbrir);
        barra.appendChild(filaBotones);

        var panel = document.createElement('div');
        panel.style.display = 'none';
        panel.style.flexDirection = 'column';
        panel.style.gap = '8px';
        panel.style.backgroundColor = '#f8f9fa';
        panel.style.border = '1px solid #dee2e6';
        panel.style.borderRadius = '8px';
        panel.style.padding = '10px';
        panel.style.marginTop = '6px';
        panel.style.width = '340px';
        panel.style.maxWidth = '90vw';
        panel.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)';
        panel.style.fontSize = '12px';
        // Flota sobre la página: no queda en el flujo normal, así que
        // abrirlo/cerrarlo no mueve nada de su alrededor.
        panel.style.position = 'absolute';
        panel.style.top = '100%';
        panel.style.left = '0';
        panel.style.zIndex = '1000';

        var buscador = document.createElement('input');
        buscador.type = 'text';
        buscador.placeholder = '🔍 Buscar...';
        buscador.style.padding = '5px 7px';
        buscador.style.fontSize = '12px';
        buscador.style.border = '1px solid #ced4da';
        buscador.style.borderRadius = '4px';
        buscador.style.width = '100%';
        buscador.style.boxSizing = 'border-box';
        panel.appendChild(buscador);

        var lista = document.createElement('div');
        lista.style.display = 'flex';
        lista.style.flexDirection = 'column';
        lista.style.gap = '2px';
        lista.style.maxHeight = '280px';
        lista.style.overflowY = 'auto';
        panel.appendChild(lista);

        var filaAcciones = document.createElement('div');
        filaAcciones.style.display = 'flex';
        filaAcciones.style.gap = '6px';
        filaAcciones.style.marginTop = '4px';

        var botonCargar = document.createElement('button');
        botonCargar.type = 'button';
        botonCargar.innerText = '➕ Cargar seleccionadas';
        botonCargar.style.flex = '1';
        botonCargar.style.padding = '6px 8px';
        botonCargar.style.fontSize = '12px';
        botonCargar.style.fontWeight = 'bold';
        botonCargar.style.color = '#fff';
        botonCargar.style.backgroundColor = colorBorde;
        botonCargar.style.border = 'none';
        botonCargar.style.borderRadius = '4px';
        botonCargar.style.cursor = 'pointer';

        var botonCancelar = document.createElement('button');
        botonCancelar.type = 'button';
        botonCancelar.innerText = 'Cancelar';
        botonCancelar.style.padding = '6px 10px';
        botonCancelar.style.fontSize = '12px';
        botonCancelar.style.color = '#495057';
        botonCancelar.style.backgroundColor = '#fff';
        botonCancelar.style.border = '1px solid #ced4da';
        botonCancelar.style.borderRadius = '4px';
        botonCancelar.style.cursor = 'pointer';

        filaAcciones.appendChild(botonCargar);
        filaAcciones.appendChild(botonCancelar);
        panel.appendChild(filaAcciones);
        barra.appendChild(panel);

        // Un registro por categoría, para que el buscador pueda filtrar sus
        // ítems y luego restaurar cómo la había dejado el técnico (abierta o
        // plegada) al borrar el texto de búsqueda.
        var grupos = [];

        function poblar(opciones) {
            lista.innerHTML = '';
            grupos = [];
            buscador.value = '';
            if (!opciones || opciones.length === 0) {
                var vacio = document.createElement('div');
                vacio.style.color = '#6c757d';
                vacio.innerText = 'Todavía no hay datos del Sheet. Usa "🔄 Recargar datos del Sheet" o revisa que el Sheet tenga filas.';
                lista.appendChild(vacio);
                return;
            }
            opciones.forEach(function(grupo) {
                var grupoDiv = document.createElement('div');

                var titulo = document.createElement('div');
                titulo.style.display = 'flex';
                titulo.style.alignItems = 'center';
                titulo.style.gap = '5px';
                titulo.style.fontWeight = 'bold';
                titulo.style.color = '#495057';
                titulo.style.cursor = 'pointer';
                titulo.style.padding = '4px 2px';
                titulo.style.borderBottom = '1px solid #dee2e6';
                titulo.style.userSelect = 'none';

                var flecha = document.createElement('span');
                flecha.innerText = '▸';
                flecha.style.fontSize = '10px';
                flecha.style.width = '10px';
                flecha.style.display = 'inline-block';

                var textoTitulo = document.createElement('span');
                textoTitulo.innerText = grupo.categoria + ' (' + grupo.items.length + ')';

                titulo.appendChild(flecha);
                titulo.appendChild(textoTitulo);
                grupoDiv.appendChild(titulo);

                var itemsDiv = document.createElement('div');
                itemsDiv.style.display = 'none'; // plegado por defecto
                itemsDiv.style.flexDirection = 'column';
                itemsDiv.style.gap = '6px';
                itemsDiv.style.padding = '6px 0 8px 15px';
                grupoDiv.appendChild(itemsDiv);

                var abiertoManual = false;
                titulo.onclick = function() {
                    abiertoManual = !abiertoManual;
                    itemsDiv.style.display = abiertoManual ? 'flex' : 'none';
                    flecha.innerText = abiertoManual ? '▾' : '▸';
                };

                var itemsBusqueda = [];

                grupo.items.forEach(function(item) {
                    var label = document.createElement('label');
                    label.style.display = 'flex';
                    label.style.alignItems = 'flex-start';
                    label.style.gap = '6px';
                    label.style.cursor = 'pointer';

                    var checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.value = item.clave;
                    checkbox.style.marginTop = '2px';

                    var texto = document.createElement('span');
                    texto.innerText = item.etiqueta;

                    label.appendChild(checkbox);
                    label.appendChild(texto);
                    itemsDiv.appendChild(label);

                    itemsBusqueda.push({ label: label, textoNormalizado: normalizarTextoBusqueda(item.etiqueta) });
                });

                lista.appendChild(grupoDiv);
                grupos.push({
                    grupoDiv: grupoDiv, itemsDiv: itemsDiv, flecha: flecha, items: itemsBusqueda,
                    categoriaNormalizada: normalizarTextoBusqueda(grupo.categoria),
                    estaAbierto: function() { return abiertoManual; }
                });
            });
        }

        // Al escribir, se despliegan solo las categorías con resultados y se
        // ocultan (sin borrarlos del DOM) los ítems que no coinciden — así
        // ninguna casilla ya marcada se pierde por filtrar. Al borrar el
        // texto, cada categoría vuelve a su estado manual (abierta/plegada).
        buscador.addEventListener('input', function() {
            var termino = normalizarTextoBusqueda(buscador.value.trim());
            grupos.forEach(function(g) {
                if (termino === '') {
                    g.grupoDiv.style.display = '';
                    g.items.forEach(function(it) { it.label.style.display = ''; });
                    var abierto = g.estaAbierto();
                    g.itemsDiv.style.display = abierto ? 'flex' : 'none';
                    g.flecha.innerText = abierto ? '▾' : '▸';
                    return;
                }
                // Si el término coincide con el nombre de la categoría (ej.
                // "conductividad"), se muestran todos sus ítems aunque el
                // texto de cada uno no lo mencione explícitamente.
                var categoriaCoincide = g.categoriaNormalizada.indexOf(termino) !== -1;
                var algunaCoincide = false;
                g.items.forEach(function(it) {
                    var coincide = categoriaCoincide || it.textoNormalizado.indexOf(termino) !== -1;
                    it.label.style.display = coincide ? '' : 'none';
                    if (coincide) algunaCoincide = true;
                });
                g.grupoDiv.style.display = algunaCoincide ? '' : 'none';
                g.itemsDiv.style.display = algunaCoincide ? 'flex' : 'none';
                g.flecha.innerText = algunaCoincide ? '▾' : '▸';
            });
        });

        poblar(opcionesIniciales);

        // Cierra el panel si se hace clic fuera de él, o con Escape — como
        // cualquier menú flotante. Los listeners solo quedan activos
        // mientras el panel está abierto, para no acumular uno por cada
        // panel de la página (puede haber varios: Mediciones Iniciales,
        // Finales y Soluciones, por cada Revisión).
        function alClicFuera(ev) {
            if (!barra.contains(ev.target)) cerrarPanel();
        }
        function alEscape(ev) {
            if (ev.key === 'Escape') cerrarPanel();
        }
        function cerrarPanel() {
            panel.style.display = 'none';
            document.removeEventListener('mousedown', alClicFuera, true);
            document.removeEventListener('keydown', alEscape, true);
        }

        botonAbrir.onclick = function() {
            var vaAAbrir = panel.style.display === 'none';
            panel.style.display = vaAAbrir ? 'flex' : 'none';
            if (vaAAbrir) {
                document.addEventListener('mousedown', alClicFuera, true);
                document.addEventListener('keydown', alEscape, true);
            } else {
                document.removeEventListener('mousedown', alClicFuera, true);
                document.removeEventListener('keydown', alEscape, true);
            }
        };

        function cerrarYLimpiarSeleccion() {
            cerrarPanel();
            [].slice.call(lista.querySelectorAll('input[type="checkbox"]')).forEach(function(cb) { cb.checked = false; });
            buscador.value = '';
            buscador.dispatchEvent(new Event('input'));
        }

        botonCancelar.onclick = cerrarYLimpiarSeleccion;

        botonCargar.onclick = function() {
            var seleccionadas = [].slice.call(lista.querySelectorAll('input[type="checkbox"]:checked')).map(function(cb) { return cb.value; });
            if (seleccionadas.length === 0) {
                alert('No seleccionaste ninguna solución.');
                return;
            }
            onCargarSeleccionadas(seleccionadas);
            cerrarYLimpiarSeleccion();
        };

        return { barra: barra, poblar: poblar };
    }

    // Combo con buscador para elegir UNA sola opción de una lista AGRUPADA
    // por categoría (a diferencia de crearPanelChecklist, que es de
    // selección múltiple con checkboxes). "opcionesAgrupadas" tiene la misma
    // forma que espera crearPanelChecklist: [{ categoria, items: [{clave,
    // etiqueta}] }]. Reemplaza a un <select> nativo, que no deja filtrar ni
    // agrupar: en vez de eso, un botón muestra la opción elegida (o el texto
    // de placeholder) y, al hacer clic, abre un panel flotante con un
    // buscador arriba y las categorías debajo — cada una empieza plegada,
    // igual que en crearPanelChecklist, y un clic en una opción la elige y
    // cierra todo el panel. Reutiliza el mismo criterio de "panel flotante"
    // (position:absolute, cierra con clic afuera o Escape) para no empujar
    // la página al abrirse.
    //
    // Tiene un poblar(opcionesAgrupadas) para poder reconstruir la lista más
    // tarde (ej. cuando el Sheet del que sale esta lista termina de cargar o
    // se recarga) sin tener que volver a crear el combo desde cero.
    function crearComboBuscable(opcionesAgrupadas, colorBorde, textoPlaceholder) {
        var contenedor = document.createElement('div');
        contenedor.style.position = 'relative';
        contenedor.style.display = 'inline-block';

        var botonSelector = document.createElement('button');
        botonSelector.type = 'button';
        botonSelector.style.fontSize = '12px';
        botonSelector.style.padding = '5px 8px';
        botonSelector.style.borderRadius = '4px';
        botonSelector.style.border = '1px solid ' + colorBorde;
        botonSelector.style.color = '#495057';
        botonSelector.style.backgroundColor = '#fff';
        botonSelector.style.cursor = 'pointer';
        botonSelector.style.maxWidth = '320px';
        botonSelector.style.display = 'inline-flex';
        botonSelector.style.alignItems = 'center';
        botonSelector.style.gap = '6px';

        var textoBoton = document.createElement('span');
        textoBoton.style.overflow = 'hidden';
        textoBoton.style.textOverflow = 'ellipsis';
        textoBoton.style.whiteSpace = 'nowrap';
        textoBoton.innerText = textoPlaceholder;
        botonSelector.appendChild(textoBoton);

        var flechaBoton = document.createElement('span');
        flechaBoton.innerText = '▾';
        flechaBoton.style.fontSize = '10px';
        flechaBoton.style.marginLeft = 'auto';
        flechaBoton.style.flexShrink = '0';
        botonSelector.appendChild(flechaBoton);

        contenedor.appendChild(botonSelector);

        var panel = document.createElement('div');
        panel.style.display = 'none';
        panel.style.flexDirection = 'column';
        panel.style.gap = '6px';
        panel.style.backgroundColor = '#f8f9fa';
        panel.style.border = '1px solid #dee2e6';
        panel.style.borderRadius = '8px';
        panel.style.padding = '8px';
        panel.style.marginTop = '4px';
        panel.style.width = '300px';
        panel.style.maxWidth = '90vw';
        panel.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)';
        panel.style.fontSize = '12px';
        panel.style.position = 'absolute';
        panel.style.top = '100%';
        panel.style.left = '0';
        panel.style.zIndex = '1000';

        var buscador = document.createElement('input');
        buscador.type = 'text';
        buscador.placeholder = '🔍 Buscar...';
        buscador.style.padding = '5px 7px';
        buscador.style.fontSize = '12px';
        buscador.style.border = '1px solid #ced4da';
        buscador.style.borderRadius = '4px';
        buscador.style.width = '100%';
        buscador.style.boxSizing = 'border-box';
        panel.appendChild(buscador);

        var lista = document.createElement('div');
        lista.style.display = 'flex';
        lista.style.flexDirection = 'column';
        lista.style.maxHeight = '240px';
        lista.style.overflowY = 'auto';
        panel.appendChild(lista);

        contenedor.appendChild(panel);

        var claveSeleccionada = '';
        var grupos = [];

        function poblar(opcionesAgrupadas) {
            lista.innerHTML = '';
            grupos = [];
            claveSeleccionada = '';
            textoBoton.innerText = textoPlaceholder;
            buscador.value = '';

            (opcionesAgrupadas || []).forEach(function(grupo) {
                var grupoDiv = document.createElement('div');

                var titulo = document.createElement('div');
                titulo.style.display = 'flex';
                titulo.style.alignItems = 'center';
                titulo.style.gap = '5px';
                titulo.style.fontWeight = 'bold';
                titulo.style.color = '#495057';
                titulo.style.cursor = 'pointer';
                titulo.style.padding = '4px 2px';
                titulo.style.borderBottom = '1px solid #dee2e6';
                titulo.style.userSelect = 'none';

                var flecha = document.createElement('span');
                flecha.innerText = '▸';
                flecha.style.fontSize = '10px';
                flecha.style.width = '10px';
                flecha.style.display = 'inline-block';

                var textoTitulo = document.createElement('span');
                textoTitulo.innerText = grupo.categoria + ' (' + grupo.items.length + ')';

                titulo.appendChild(flecha);
                titulo.appendChild(textoTitulo);
                grupoDiv.appendChild(titulo);

                var itemsDiv = document.createElement('div');
                itemsDiv.style.display = 'none'; // plegado por defecto
                itemsDiv.style.flexDirection = 'column';
                itemsDiv.style.padding = '2px 0 4px 15px';
                grupoDiv.appendChild(itemsDiv);

                var abiertoManual = false;
                titulo.onclick = function() {
                    abiertoManual = !abiertoManual;
                    itemsDiv.style.display = abiertoManual ? 'flex' : 'none';
                    flecha.innerText = abiertoManual ? '▾' : '▸';
                };

                var itemsBusqueda = [];

                grupo.items.forEach(function(opcion) {
                    var item = document.createElement('div');
                    item.innerText = opcion.etiqueta;
                    item.style.padding = '6px 8px';
                    item.style.borderRadius = '4px';
                    item.style.cursor = 'pointer';
                    item.onmouseenter = function() { item.style.backgroundColor = '#e9ecef'; };
                    item.onmouseleave = function() { item.style.backgroundColor = ''; };
                    item.onclick = function() {
                        claveSeleccionada = opcion.clave;
                        textoBoton.innerText = opcion.etiqueta;
                        cerrarPanel();
                    };
                    itemsDiv.appendChild(item);
                    itemsBusqueda.push({ elemento: item, textoNormalizado: normalizarTextoBusqueda(opcion.etiqueta) });
                });

                lista.appendChild(grupoDiv);
                grupos.push({
                    grupoDiv: grupoDiv, itemsDiv: itemsDiv, flecha: flecha, items: itemsBusqueda,
                    categoriaNormalizada: normalizarTextoBusqueda(grupo.categoria),
                    estaAbierto: function() { return abiertoManual; }
                });
            });
        }

        // Igual que en crearPanelChecklist: al escribir se despliegan solo
        // las categorías con resultados (por texto de la opción o por nombre
        // de categoría) y al borrar la búsqueda cada una vuelve a quedar
        // como el técnico la había dejado.
        buscador.addEventListener('input', function() {
            var termino = normalizarTextoBusqueda(buscador.value.trim());
            grupos.forEach(function(g) {
                if (termino === '') {
                    g.grupoDiv.style.display = '';
                    g.items.forEach(function(it) { it.elemento.style.display = ''; });
                    var abierto = g.estaAbierto();
                    g.itemsDiv.style.display = abierto ? 'flex' : 'none';
                    g.flecha.innerText = abierto ? '▾' : '▸';
                    return;
                }
                var categoriaCoincide = g.categoriaNormalizada.indexOf(termino) !== -1;
                var algunaCoincide = false;
                g.items.forEach(function(it) {
                    var coincide = categoriaCoincide || it.textoNormalizado.indexOf(termino) !== -1;
                    it.elemento.style.display = coincide ? '' : 'none';
                    if (coincide) algunaCoincide = true;
                });
                g.grupoDiv.style.display = algunaCoincide ? '' : 'none';
                g.itemsDiv.style.display = algunaCoincide ? 'flex' : 'none';
                g.flecha.innerText = algunaCoincide ? '▾' : '▸';
            });
        });

        poblar(opcionesAgrupadas);

        function alClicFuera(ev) {
            if (!contenedor.contains(ev.target)) cerrarPanel();
        }
        function alEscape(ev) {
            if (ev.key === 'Escape') cerrarPanel();
        }
        function cerrarPanel() {
            panel.style.display = 'none';
            buscador.value = '';
            buscador.dispatchEvent(new Event('input'));
            document.removeEventListener('mousedown', alClicFuera, true);
            document.removeEventListener('keydown', alEscape, true);
        }

        botonSelector.onclick = function() {
            var vaAAbrir = panel.style.display === 'none';
            panel.style.display = vaAAbrir ? 'flex' : 'none';
            if (vaAAbrir) {
                buscador.focus();
                document.addEventListener('mousedown', alClicFuera, true);
                document.addEventListener('keydown', alEscape, true);
            } else {
                document.removeEventListener('mousedown', alClicFuera, true);
                document.removeEventListener('keydown', alEscape, true);
            }
        };

        return {
            contenedor: contenedor,
            obtenerValor: function() { return claveSeleccionada; },
            poblar: poblar
        };
    }

    // Inyecta el panel de Mediciones Iniciales/Finales para CADA Revisión
    // presente en la página que todavía no lo tenga. "tipo" es 'iniciales' o
    // 'finales' (clave dentro de controlesInyectados/las listas de refs);
    // "prefijoBase" es el nombre base del campo ("mediciones_iniciales" o
    // "mediciones_finales"); "colorBorde"/"etiquetaBoton" son de estilo, y
    // "listaRefs" es el arreglo (panelesLecturasIniRef o …FinRef) donde se
    // guarda cada panel para poder refrescarlo luego.
    function inyectarPanelesLecturas(tipo, prefijoBase, colorBorde, etiquetaBoton, listaRefs, funcionBorrarTabla) {
        var prefijosPorRevision = extraerPrefijosPorRevision(prefijoBase);
        var revisiones = Object.keys(prefijosPorRevision);
        var multiplesRevisiones = revisiones.length > 1;

        revisiones.forEach(function(rev) {
            if (controlesInyectados[tipo][rev]) return;
            var prefijoRevision = prefijosPorRevision[rev];
            var refCampo = document.querySelector('input[name^="' + prefijoRevision + '"]');
            if (!refCampo) return;

            var etiqueta = multiplesRevisiones ? (etiquetaBoton + ' (Revisión ' + rev + ')') : etiquetaBoton;
            var panel = crearPanelChecklist(construirOpcionesLecturasDesdeSheet(), colorBorde, etiqueta, function(clavesSeleccionadas) {
                clavesSeleccionadas.forEach(function(clave) {
                    var fila = datosLecturas[Number(clave)];
                    if (!fila) return;
                    agregarLecturaSecuencial(prefijoRevision, [fila.valor, fila.ayuda, fila.tolerancia]);
                });
            });
            listaRefs.push(panel);

            var filaBotones = panel.barra.firstChild;
            filaBotones.appendChild(crearBotonIcono('🗑️', 'Borrar esta tabla de Mediciones', colorBorde, function() { funcionBorrarTabla(prefijoRevision); }));

            if (anclarAntesDeTabla(refCampo, panel.barra)) {
                controlesInyectados[tipo][rev] = true;
                inyectarBotonesLimpiarFilaLecturas(prefijoRevision);
                inyectarBotonesEstadoLecturas(prefijoRevision);
            }
        });
    }

    // Confirmado con un campo real del Informe 2: "soluciones_codigo[2][1]"
    // — igual que Mediciones, Soluciones Estándar SÍ trae el número de
    // Revisión entre corchetes justo después del nombre del campo. Antes el
    // código asumía (a falta de esa confirmación) que era una sola tabla
    // para toda la página, así que solo alcanzaba a poner el botón "Elegir…"
    // en la primera tabla que encontraba — el resto de Revisiones se
    // quedaban sin botón. Ahora se reparte por Revisión, igual que ya hace
    // inyectarPanelesLecturas.
    //
    // Las otras 3 columnas (Lote, Vencimiento, Descripción) no comparten el
    // prefijo "soluciones_codigo", pero si tienen "soluciones" en el nombre
    // en algún lado (confirmado porque ya funcionaban en la tabla de la
    // Revisión 1); por eso, en vez de adivinar sus nombres exactos, cada
    // Revisión se identifica por la TABLA que contiene a su campo "Código"
    // (closest('table')), y esa tabla es la que se le pasa como "alcance" a
    // obtenerInputsSoluciones/agregarSolucionSecuencial/etc. — así cada
    // panel solo toca los campos de SU PROPIA tabla, nunca los de otra
    // Revisión.
    function inyectarPanelesSoluciones() {
        var prefijosPorRevision = extraerPrefijosPorRevision(PREFIJO_SOLUCIONES);
        var revisiones = Object.keys(prefijosPorRevision);
        var multiplesRevisiones = revisiones.length > 1;

        revisiones.forEach(function(rev) {
            if (controlesInyectados.soluciones[rev]) return;
            var prefijoRevision = prefijosPorRevision[rev];
            var refCampo = document.querySelector('input[name^="' + prefijoRevision + '"]');
            if (!refCampo) return;
            var tabla = refCampo.closest('table') || refCampo.closest('tbody') || document;

            var etiqueta = multiplesRevisiones ? ('🧴 Elegir Soluciones Estándar… (Revisión ' + rev + ')') : '🧴 Elegir Soluciones Estándar…';
            var panel = crearPanelChecklist(construirOpcionesSolucionesDesdeSheet(), '#28a745', etiqueta, function(clavesSeleccionadas) {
                clavesSeleccionadas.forEach(function(clave) {
                    var fila = datosSheet[Number(clave)];
                    if (!fila) return;
                    agregarSolucionSecuencial([fila.codigo, fila.lote, fila.venc, fila.desc], tabla);
                });
            });
            panelesSolucionesRef.push(panel);

            var filaBotonesSol = panel.barra.firstChild; // la fila con el botón "Elegir…"
            filaBotonesSol.appendChild(crearBotonIcono('🗑️', 'Borrar esta tabla de Soluciones Estándar', '#28a745', function() { borrarSolucionesSecuencial(tabla); }));
            filaBotonesSol.appendChild(crearBotonIcono('✏️', 'Abrir el Google Sheet de lotes/vencimientos', '#28a745', abrirEditorSheet));

            if (anclarAntesDeTabla(refCampo, panel.barra)) {
                controlesInyectados.soluciones[rev] = true;
                inyectarBotonesLimpiarFila(tabla);
            }
        });
    }

    function intentarInyectarControles() {
        inyectarPanelesLecturas('iniciales', PREFIJO_MEDICIONES_INICIALES, '#17a2b8', '🧪 Elegir Mediciones Iniciales…', panelesLecturasIniRef, borrarLecturas);
        inyectarPanelesLecturas('finales', PREFIJO_MEDICIONES_FINALES, '#17a2b8', '🧪 Elegir Mediciones Finales…', panelesLecturasFinRef, borrarMedicionesFinales);
        inyectarPanelesSoluciones();

        intentarInyectarBadge();
    }

    // Este observer ya NO se desconecta solo: como el técnico puede activar
    // una nueva "Revisión" (con sus propias tablas de Mediciones/Soluciones)
    // en cualquier momento mientras trabaja en la página, hay que seguir
    // vigilando todo el tiempo — mismo criterio que ya se usa para las
    // plantillas de Diagnóstico Preliminar más abajo.
    var observadorDOM = new MutationObserver(function() { intentarInyectarControles(); });
    observadorDOM.observe(document.body, { childList: true, subtree: true });

    // ==========================================
    // 4. PLANTILLAS DE "DIAGNÓSTICO PRELIMINAR" DESDE ARCHIVOS .TXT EN GOOGLE DRIVE
    // ==========================================
    // Cada plantilla es un .txt con 5 secciones marcadas con "###NOMBRE###",
    // una por cada campo del bloque "Diagnóstico Preliminar". El técnico elige
    // el tipo de equipo en un desplegable y el texto de cada sección reemplaza
    // el contenido del campo correspondiente (no se acumula, a diferencia de
    // Soluciones/Mediciones).
    //
    // Esta sección puede tener hasta 5 "Revisión" en la misma página
    // (Revisión 1, 2, 3...), cada una con su propio juego de 5 campos cuyo id
    // termina en "-1", "-2", etc. Por eso los campos se ubican por PATRÓN de
    // id (prefijo + número de revisión), nunca por un id fijo.

    // Nota: NO se usa Google Drive aquí — los links de descarga directa de
    // Drive no permiten fetch() desde otro sitio (bloqueo de CORS), así que
    // los .txt viven en el mismo repo de GitHub que ya sirve los scripts
    // (raw.githubusercontent.com sí permite esto, es justo lo que usa
    // Tampermonkey para @updateURL/@downloadURL).
    var GITHUB_PLANTILLAS_BASE = 'https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/plantillas-diagnostico/';

    // Ya NO es una lista fija: se construye en vivo desde datosPlantillasSheet
    // (la pestaña "plantillas" del Sheet, ver sección 0c más arriba), igual
    // que ya pasa con Soluciones/Mediciones. datosPlantillasSheet arranca con
    // estas mismas 5 filas como valor por defecto — si el Sheet todavía no
    // cargó (o algún día no responde y tampoco hay caché), el técnico sigue
    // viendo estas plantillas conocidas en vez de una lista vacía.
    datosPlantillasSheet = [
        { categoria: 'Tester', etiqueta: '🧪 Tester pH/ORP/CE (HI 9XXXX)', archivo: 'tester-ph-orp-ce.txt' },
        { categoria: 'Multiparámetro', etiqueta: '🧪 Multiparámetro de sobremesa', archivo: 'multiparametro-sobremesa.txt' },
        { categoria: 'Multiparámetro', etiqueta: '🧪 Multiparámetro portátil (HI 98XXX)', archivo: 'multiparametro-portatil.txt' },
        { categoria: 'Sonda', etiqueta: '🧪 pH/ISE/ORP/CE portátil', archivo: 'ph-ise-orp-ce-portatil.txt' },
        { categoria: 'Oxímetro', etiqueta: '🧪 Oxímetro portátil', archivo: 'oximetro-portatil.txt' }
    ];

    // Agrupa datosPlantillasSheet por "categoria", igual criterio que
    // construirOpcionesLecturasDesdeSheet/construirOpcionesSolucionesDesdeSheet:
    // un grupo (categoría) por cada valor distinto, en el orden en que
    // aparecen las filas en el Sheet, y la "clave" de cada ítem es su índice
    // dentro de datosPlantillasSheet (para poder recuperar la fila completa
    // después con obtenerPlantillaPorClave).
    function construirPlantillasAgrupadasDesdeSheet() {
        var grupos = {};
        var orden = [];
        datosPlantillasSheet.forEach(function(fila, indice) {
            var categoria = fila.categoria || 'Sin categoría';
            if (!grupos[categoria]) { grupos[categoria] = []; orden.push(categoria); }
            grupos[categoria].push({ clave: String(indice), etiqueta: fila.etiqueta });
        });
        return orden.map(function(categoria) {
            return { categoria: categoria, items: grupos[categoria] };
        });
    }

    // Recupera la plantilla completa (con la URL ya armada) a partir de la
    // "clave" (índice) que devuelve el combo-con-buscador al elegir una.
    function obtenerPlantillaPorClave(clave) {
        var fila = datosPlantillasSheet[Number(clave)];
        if (!fila) return null;
        return { clave: clave, etiqueta: fila.etiqueta, url: GITHUB_PLANTILLAS_BASE + fila.archivo, archivo: fila.archivo };
    }

    // Uno por cada combo de "Elegir plantilla de diagnóstico…" inyectado (uno
    // por Revisión), para poder refrescarlos todos cuando el Sheet cambie o
    // se recargue — igual que panelesSolucionesRef/panelesLecturasIniRef.
    var combosPlantillasRef = [];

    function refrescarComboPlantillas() {
        var agrupadas = construirPlantillasAgrupadasDesdeSheet();
        combosPlantillasRef.forEach(function(combo) { combo.poblar(agrupadas); });
    }

    // ─────────────────────────────────────────────
    // Resaltado en vivo de HTML dentro de los campos de Diagnóstico
    // Preliminar. Las plantillas (y lo que se escriba a mano) usan etiquetas
    // como <b> y <mark style="..."> que el sistema interpreta al generar el
    // informe — pero mientras se escribe, el campo solo muestra texto plano,
    // así que si falta un ">" o una etiqueta queda sin cerrar, no se nota
    // hasta que el informe ya salió mal. Esto pinta las etiquetas de un
    // color y resalta en rojo cualquier etiqueta rota, directamente encima
    // del campo real (una capa visual: lo que se guarda en el campo no
    // cambia en nada).
    // ─────────────────────────────────────────────
    var VOID_ELEMENTS_HTML = { br: true, hr: true, img: true };

    function tokenizarHTML(texto) {
        var tokens = [];
        var i = 0;
        while (i < texto.length) {
            if (texto.charAt(i) === '<') {
                var cierre = texto.indexOf('>', i);
                var siguienteApertura = texto.indexOf('<', i + 1);
                if (cierre === -1 || (siguienteApertura !== -1 && siguienteApertura < cierre)) {
                    var fin = siguienteApertura !== -1 ? siguienteApertura : texto.length;
                    tokens.push({ tipo: 'error', texto: texto.slice(i, fin), inicio: i, fin: fin });
                    i = fin;
                } else {
                    tokens.push({ tipo: 'tag', texto: texto.slice(i, cierre + 1), inicio: i, fin: cierre + 1 });
                    i = cierre + 1;
                }
            } else {
                var next = texto.indexOf('<', i);
                var end = next === -1 ? texto.length : next;
                tokens.push({ tipo: 'text', texto: texto.slice(i, end), inicio: i, fin: end });
                i = end;
            }
        }
        return tokens;
    }

    function numeroDeLineaHTML(texto, pos) {
        return texto.slice(0, pos).split('\n').length;
    }

    function validarBalanceHTML(tagTokens, texto) {
        var pila = [];
        var problemas = [];
        tagTokens.forEach(function(t) {
            var m = t.texto.match(/^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/);
            if (!m) return;
            var esCierre = m[1] === '/';
            var nombre = m[2].toLowerCase();
            var autoCerrada = /\/>\s*$/.test(t.texto) || VOID_ELEMENTS_HTML[nombre];
            if (esCierre) {
                var idx = -1;
                for (var k = pila.length - 1; k >= 0; k--) {
                    if (pila[k].nombre === nombre) { idx = k; break; }
                }
                if (idx === pila.length - 1) {
                    pila.pop();
                } else if (idx > -1) {
                    for (var r = pila.length - 1; r > idx; r--) {
                        problemas.push('Falta cerrar <' + pila[r].nombre + '> (línea ' + numeroDeLineaHTML(texto, pila[r].pos) + ')');
                    }
                    pila.length = idx;
                } else {
                    problemas.push('</' + nombre + '> sin apertura (línea ' + numeroDeLineaHTML(texto, t.inicio) + ')');
                }
            } else if (!autoCerrada) {
                pila.push({ nombre: nombre, pos: t.inicio });
            }
        });
        pila.forEach(function(s) {
            problemas.push('<' + s.nombre + '> nunca se cierra (línea ' + numeroDeLineaHTML(texto, s.pos) + ')');
        });
        return problemas;
    }

    function calcularProblemasHTML(texto) {
        var tokens = tokenizarHTML(texto);
        var tagTokens = tokens.filter(function(t) { return t.tipo === 'tag'; });
        var problemas = validarBalanceHTML(tagTokens, texto);
        tokens.forEach(function(t) {
            if (t.tipo === 'error') {
                problemas.push('Falta el ">" que cierra una etiqueta (línea ' + numeroDeLineaHTML(texto, t.inicio) + ')');
            }
        });
        return problemas;
    }

    function escaparHTML(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function resaltarTagHTML(tagTexto) {
        var m = tagTexto.match(/^(<\/?)([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)(\/?>)$/);
        if (!m) return escaparHTML(tagTexto);
        var apertura = escaparHTML(m[1]);
        var nombre = '<span style="color:#0e7c86;font-weight:600;">' + escaparHTML(m[2]) + '</span>';
        var resto = escaparHTML(m[3]).replace(/([a-zA-Z-]+)(=)(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;)/g, function(full, an, eq, av) {
            return '<span style="color:#9a6b00;">' + an + '</span>' + eq + '<span style="color:#2f7d4f;">' + av + '</span>';
        });
        var cierre = escaparHTML(m[4]);
        return apertura + nombre + resto + cierre;
    }

    // "agregarSaltoFinal" evita que un <textarea> colapse visualmente el
    // último salto de línea; en un <input> (una sola línea) no aplica.
    function generarHTMLResaltado(texto, agregarSaltoFinal) {
        var tokens = tokenizarHTML(texto);
        var html = '';
        tokens.forEach(function(t) {
            if (t.tipo === 'tag') {
                html += '<span style="background:rgba(14,124,134,0.10);border-radius:2px;">' + resaltarTagHTML(t.texto) + '</span>';
            } else if (t.tipo === 'error') {
                html += '<span style="background:#fbe4e2;color:#b3261e;text-decoration:underline wavy #b3261e;border-radius:2px;">' + escaparHTML(t.texto) + '</span>';
            } else {
                html += escaparHTML(t.texto);
            }
        });
        return agregarSaltoFinal ? html + '\n' : html;
    }

    // Propiedades que afectan cómo se ve/envuelve el texto: se copian del
    // campo real a la capa de resaltado para que ambas capas queden
    // exactamente encimadas (mismo tamaño de letra, mismo relleno, etc.),
    // sin importar el CSS propio de la intranet.
    var PROPIEDADES_A_COPIAR_RESALTADO = [
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
        'letterSpacing', 'wordSpacing', 'textIndent', 'textAlign', 'direction',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
        'boxSizing', 'tabSize'
    ];

    // Ancho del contador de líneas (regla), solo para los 5 campos grandes
    // de Diagnóstico Preliminar. No aplica a Mediciones/Soluciones.
    var ANCHO_REGLA = 32;

    // Oculta la barra de scroll propia de la capa de resaltado (el scroll
    // real que usa el técnico es el del campo real, que queda encima; el de
    // la capa solo se sincroniza por código para que el texto no se desfase
    // al hacer scroll). Se agrega una sola vez para toda la página.
    function asegurarEstiloOcultarScrollCapa() {
        if (document.getElementById('hanna-resaltado-estilos')) return;
        var tag = document.createElement('style');
        tag.id = 'hanna-resaltado-estilos';
        tag.textContent = '.hanna-resaltado-capa{scrollbar-width:none;-ms-overflow-style:none;}' +
            '.hanna-resaltado-capa::-webkit-scrollbar{display:none;width:0;height:0;}';
        document.head.appendChild(tag);
    }

    // OJO: la envoltura NO fija un ancho/alto en píxeles a mano (una versión
    // anterior lo hizo copiando offsetWidth/offsetHeight, y en producción
    // eso generó una barra de scroll horizontal larguísima porque ese
    // cálculo no coincidía con el tamaño real del campo en el layout de la
    // intranet). En vez de eso, el campo real se queda en flujo normal
    // (position: relative, no absolute) con su tamaño de siempre, y la
    // envoltura — que solo lo contiene a él — se ajusta sola a ese mismo
    // tamaño porque no tiene ancho/alto propio. La capa de resaltado, con
    // position: absolute + inset 0 dentro de esa envoltura, queda calzada
    // automáticamente sin necesitar copiar ningún número.
    // El aviso de error se pone DENTRO de la envoltura, como un globito
    // flotante (position: absolute) en vez de un elemento normal del flujo.
    // Así nunca empuja ni desalinea nada a su alrededor — algo que importa
    // sobre todo en Mediciones/Soluciones, donde varios campos van pegados
    // uno junto al otro en la misma fila.
    function crearAvisoFlotante() {
        var aviso = document.createElement('div');
        aviso.className = 'hanna-resaltado-aviso';
        aviso.style.position = 'absolute';
        aviso.style.zIndex = '5';
        aviso.style.fontSize = '11px';
        aviso.style.lineHeight = '1.4';
        aviso.style.maxWidth = '320px';
        aviso.style.padding = '3px 7px';
        aviso.style.borderRadius = '4px';
        aviso.style.fontFamily = 'Arial, Helvetica, sans-serif';
        aviso.style.color = '#b3261e';
        aviso.style.background = '#fbe4e2';
        aviso.style.border = '1px solid #f0b7b2';
        aviso.style.boxShadow = '0 2px 6px rgba(0,0,0,0.12)';
        aviso.style.display = 'none';
        return aviso;
    }

    // OJO: a diferencia de las versiones anteriores (v16.7-16.11), el campo
    // real NUNCA se mueve a un nuevo <div> envoltorio — eso fue lo que rompió
    // el ancho en Mediciones/Soluciones (production: v16.11 dejó los campos
    // "muy pequeños"). Cualquier envoltorio nuevo pierde la relación de CSS
    // que el sitio usa para darle su ancho al campo (flex, %, celda de
    // tabla...), y no hay forma de adivinar cuál es sin ver el CSS real.
    //
    // En vez de envolver, el campo se queda exactamente donde estaba, con su
    // padre de siempre — solo se asegura que ese padre tenga
    // "position: relative" (si ya no tenía una posición propia), lo cual NO
    // cambia en nada su tamaño ni el de sus hermanos. La capa de color y el
    // aviso son hermanos del campo, dibujados como position:absolute y
    // alineados por MEDICIÓN (offsetLeft/offsetTop/offsetWidth/offsetHeight)
    // en vez de por estructura. Si algo sale mal aquí, en el peor caso el
    // dibujo queda mal alineado — pero el campo real jamás cambia de tamaño.
    function asegurarContenedorPosicionado(campo) {
        var padre = campo.parentNode;
        if (!padre) return null;
        var estiloPadre = window.getComputedStyle(padre);
        if (estiloPadre.position === 'static') {
            padre.style.position = 'relative';
        }
        return padre;
    }

    function sincronizarCapaConCampo(campo, capa) {
        capa.style.left = campo.offsetLeft + 'px';
        capa.style.top = campo.offsetTop + 'px';
        capa.style.width = campo.offsetWidth + 'px';
        capa.style.height = campo.offsetHeight + 'px';
    }

    // La regla (contador de líneas) ocupa la misma franja izquierda que el
    // padding extra que se le agregó al campo (ver activarResaltadoCompleto),
    // así que queda pegada al borde izquierdo del campo, con el mismo alto.
    function sincronizarReglaConCampo(campo, regla) {
        regla.style.left = campo.offsetLeft + 'px';
        regla.style.top = campo.offsetTop + 'px';
        regla.style.height = campo.offsetHeight + 'px';
    }

    // Crea el contador de líneas: mismo fondo blanco del campo (no se agrega
    // ningún panel de color nuevo, tal como se pidió), números en gris suave
    // y una línea muy tenue a la derecha solo para separar visualmente el
    // contador del texto — sin tocar el fondo de la página.
    function crearRegla(estilo, fondoOriginal) {
        var regla = document.createElement('div');
        regla.className = 'hanna-resaltado-regla';
        regla.setAttribute('aria-hidden', 'true');
        regla.style.position = 'absolute';
        regla.style.zIndex = '0';
        regla.style.width = ANCHO_REGLA + 'px';
        regla.style.overflow = 'hidden';
        regla.style.boxSizing = 'border-box';
        regla.style.background = fondoOriginal;
        regla.style.borderRight = '1px solid rgba(0,0,0,0.12)';
        regla.style.color = '#9aa0a6';
        regla.style.textAlign = 'right';
        regla.style.paddingRight = '4px';
        regla.style.whiteSpace = 'pre';
        regla.style.pointerEvents = 'none';
        regla.style.fontFamily = estilo.fontFamily;
        regla.style.fontSize = estilo.fontSize;
        regla.style.lineHeight = estilo.lineHeight;
        regla.style.paddingTop = estilo.paddingTop;
        return regla;
    }

    // Numera por línea LÓGICA (separada por \n), igual que los mensajes de
    // error ("línea N"). Si una línea larga se envuelve en varias filas
    // visuales dentro del campo, el número de la siguiente línea puede no
    // quedar exactamente al lado de su primera fila visual — es una
    // simplificación aceptada, igual que hacen muchos editores sencillos.
    function actualizarRegla(campo, regla) {
        var totalLineas = campo.value.split('\n').length;
        var numeros = [];
        for (var i = 1; i <= totalLineas; i++) numeros.push(i);
        regla.textContent = numeros.join('\n');
    }

    function sincronizarAvisoConCampo(campo, aviso) {
        aviso.style.left = campo.offsetLeft + 'px';
        aviso.style.top = (campo.offsetTop + campo.offsetHeight + 3) + 'px';
    }

    // Mantiene la capa/el aviso pegados al campo si su tamaño o posición
    // cambian (ventana redimensionada, el técnico agranda un <textarea>
    // arrastrando la esquina, etc.).
    function observarGeometria(campo, sincronizar) {
        sincronizar();
        if (window.ResizeObserver) new ResizeObserver(sincronizar).observe(campo);
        window.addEventListener('resize', sincronizar);
    }

    // Modo completo (para los 5 campos grandes de Diagnóstico Preliminar,
    // que son <textarea>): pinta las etiquetas de color directamente encima
    // del texto, con una capa transparente superpuesta al campo real.
    function activarResaltadoCompleto(campo) {
        asegurarEstiloOcultarScrollCapa();
        var padre = asegurarContenedorPosicionado(campo);
        if (!padre) return;

        var estilo = window.getComputedStyle(campo);
        // OJO: getComputedStyle() devuelve un objeto "vivo" — si se lee
        // estilo.color DESPUÉS de poner campo.style.color en transparente,
        // ya devuelve ese transparente (como "rgba(0, 0, 0, 0)", que no es
        // igual al string "transparent", así que el chequeo de más abajo no
        // lo detectaba) y el cursor de escritura terminaba siendo invisible.
        // Por eso el color y el fondo originales se copian a variables ANTES
        // de tocar el estilo del campo.
        var colorOriginalTexto = estilo.color;
        var fondoOriginal = estilo.backgroundColor;

        // Se reserva el espacio del contador DENTRO del propio campo,
        // agrandando su padding-izquierdo, en vez de agregar un elemento
        // nuevo al lado (un envoltorio nuevo fue justo lo que rompió el
        // ancho de Mediciones/Soluciones — ver notas de v16.12 arriba).
        // Se fuerza box-sizing:border-box ANTES de sumar el padding para
        // que ese padding extra se "coma" espacio interno en vez de sumar
        // ancho por fuera, así el ancho total visible del campo no cambia.
        var paddingIzquierdoOriginalPx = parseFloat(estilo.paddingLeft) || 0;
        campo.style.boxSizing = 'border-box';
        campo.style.paddingLeft = (paddingIzquierdoOriginalPx + ANCHO_REGLA) + 'px';
        // OJO: estilo (getComputedStyle) es un objeto "vivo" — a partir de
        // aquí, estilo.paddingLeft/estilo.boxSizing ya reflejan los valores
        // recién puestos, así que la capa (más abajo) copia automáticamente
        // el padding nuevo y el texto coloreado queda alineado con el texto
        // real del campo, corrido hacia la derecha del contador.

        var capa = document.createElement('div');
        capa.className = 'hanna-resaltado-capa';
        capa.setAttribute('aria-hidden', 'true');
        capa.style.position = 'absolute';
        capa.style.zIndex = '0';
        capa.style.margin = '0';
        capa.style.overflow = 'auto';
        capa.style.whiteSpace = 'pre-wrap';
        capa.style.wordWrap = 'break-word';
        capa.style.pointerEvents = 'none';
        capa.style.background = fondoOriginal;
        capa.style.color = colorOriginalTexto;
        PROPIEDADES_A_COPIAR_RESALTADO.forEach(function(prop) { capa.style[prop] = estilo[prop]; });
        capa.style.borderColor = 'transparent';
        padre.insertBefore(capa, campo);

        // El campo se queda en su mismo padre y su mismo lugar del flujo
        // normal — "position: relative" sin mover nada (sin top/left) no le
        // cambia el tamaño en nada, solo permite que pinte encima de la capa.
        campo.style.position = 'relative';
        campo.style.zIndex = '1';
        campo.style.background = 'transparent';
        campo.style.color = 'transparent';
        campo.style.webkitTextFillColor = 'transparent';
        campo.style.caretColor = (colorOriginalTexto && colorOriginalTexto.indexOf('rgba(0, 0, 0, 0)') === -1 && colorOriginalTexto !== 'transparent') ? colorOriginalTexto : '#000';

        var regla = crearRegla(estilo, fondoOriginal);
        padre.insertBefore(regla, campo);

        var aviso = crearAvisoFlotante();
        padre.appendChild(aviso);

        function sincronizarGeometria() {
            sincronizarCapaConCampo(campo, capa);
            sincronizarReglaConCampo(campo, regla);
            sincronizarAvisoConCampo(campo, aviso);
        }

        function actualizar() {
            capa.innerHTML = generarHTMLResaltado(campo.value, true);
            actualizarRegla(campo, regla);
            sincronizarGeometria();
            var problemas = calcularProblemasHTML(campo.value);
            if (problemas.length === 0) {
                aviso.style.display = 'none';
            } else {
                aviso.style.display = 'block';
                aviso.innerText = '⚠️ ' + problemas.join(' · ');
            }
        }

        campo.addEventListener('input', actualizar);
        campo.addEventListener('scroll', function() {
            capa.scrollTop = campo.scrollTop;
            capa.scrollLeft = campo.scrollLeft;
            regla.scrollTop = campo.scrollTop;
        });

        observarGeometria(campo, sincronizarGeometria);
        actualizar();
    }

    // Modo simple (para los <input> de Mediciones/Soluciones): estos campos
    // son angostos, así que mostrar el HTML coloreado carácter por carácter
    // termina recortado feo contra el borde — es un problema de espacio, no
    // de resaltado. Acá el campo real no se toca EN NADA (ni color, ni
    // fondo, ni posición): solo se le pone un contorno rojo cuando algo está
    // roto, con el mismo aviso flotante explicando qué.
    function activarValidacionSimple(campo) {
        var padre = asegurarContenedorPosicionado(campo);
        if (!padre) return;

        var aviso = crearAvisoFlotante();
        padre.appendChild(aviso);

        function actualizar() {
            sincronizarAvisoConCampo(campo, aviso);
            var problemas = calcularProblemasHTML(campo.value);
            if (problemas.length === 0) {
                aviso.style.display = 'none';
                campo.style.outline = '';
            } else {
                aviso.style.display = 'block';
                aviso.innerText = '⚠️ ' + problemas.join(' · ');
                campo.style.outline = '2px solid #b3261e';
            }
        }

        campo.addEventListener('input', actualizar);
        observarGeometria(campo, function() { sincronizarAvisoConCampo(campo, aviso); });
        actualizar();
    }

    function envolverConResaltadoHTML(campo) {
        if (!campo || campo.dataset.hannaResaltado === '1') return;
        campo.dataset.hannaResaltado = '1';

        if (campo.tagName === 'INPUT') {
            activarValidacionSimple(campo);
        } else {
            activarResaltadoCompleto(campo);
        }
    }

    // idBase + sufijo ("1", "2"...) = id real del campo en esa Revisión.
    var CAMPOS_DIAGNOSTICO = [
        { clave: 'ESTADO_FISICO_EXTERNO', idBase: 'edit-diagnostico-preliminar-estado-fisico-externo-' },
        { clave: 'ESTADO_FISICO_INTERNO', idBase: 'edit-diagnostico-preliminar-estado-fisico-interno-' },
        { clave: 'DE ACUERDO CON LOS RESULTADOS OBTENIDOS ¿SE REQUIEREN ACCIONES CORRECTIVAS O PREVENTIVAS?', idBase: 'diagnostico_preliminar_procedimiento_efectuado_' },
        { clave: 'MÉTODO_DE_VERIIFCACIÓN', idBase: 'edit-metodo-verificacion-' },
        { clave: 'OBSERVACIONES', idBase: 'edit-observaciones-recomendaciones-' }
    ];

    var ID_BASE_ESTADO_EXTERNO = CAMPOS_DIAGNOSTICO[0].idBase; // sirve para detectar cuántas Revisiones hay

    // Descarga el .txt de la plantilla (sin caché de navegador) y, si falla,
    // usa la última copia guardada en localStorage. Llama a "callback" con el
    // texto si lo consigue (por descarga o por caché), o con null si no hay
    // forma de conseguirlo — SIEMPRE llama a "callback" una vez, para que
    // quien lo use pueda restaurar su botón aunque falle.
    function obtenerTextoPlantilla(plantilla, callback) {
        // Se usa el nombre del ARCHIVO (no "clave", que ahora es solo el
        // índice de la fila en el Sheet y puede correrse si se reordenan
        // filas) para que la caché de cada plantilla sea siempre la misma,
        // sin importar en qué posición quede dentro de la hoja.
        var cacheKey = 'hanna_plantilla_cache_' + (plantilla.archivo || plantilla.clave);
        fetch(plantilla.url, { cache: 'no-store' })
            .then(function(r) { return r.text(); })
            .then(function(texto) {
                try { localStorage.setItem(cacheKey, texto); } catch (e) { /* sin cache, no pasa nada */ }
                callback(texto);
            })
            .catch(function(err) {
                console.warn('[Panel Hanna] No se pudo descargar la plantilla "' + plantilla.etiqueta + '".', err);
                var cache = null;
                try { cache = localStorage.getItem(cacheKey); } catch (e) { /* nada que usar */ }
                if (cache) {
                    callback(cache);
                } else {
                    alert('No se pudo descargar la plantilla "' + plantilla.etiqueta + '" y no hay una copia guardada localmente. Revisa tu conexión e intenta de nuevo.');
                    callback(null);
                }
            });
    }

    // Parte el texto de la plantilla en un objeto { NOMBRE_SECCION: contenido },
    // usando "###NOMBRE###" (solo en su propia línea) como separador.
    function parsearPlantilla(texto) {
        var secciones = {};
        var partes = (texto || '').replace(/\r\n/g, '\n').split(/^###(.+?)###[ \t]*$/m);
        for (var i = 1; i < partes.length; i += 2) {
            var nombre = (partes[i] || '').trim().toUpperCase();
            secciones[nombre] = (partes[i + 1] || '').trim();
        }
        return secciones;
    }

    // Guarda, por sufijo de Revisión, la lista de etiquetas de las
    // plantillas que se han cargado ahí (en el orden en que se cargaron),
    // para poder mostrar el aviso "Se cargaron: X, Y" y para que sobreviva
    // a que el panel se vuelva a inyectar (por ejemplo tras un re-render).
    var plantillasCargadasPorRevision = {};

    // Agrega (NO reemplaza) el contenido de cada sección de la plantilla al
    // final de lo que ya haya en su campo correspondiente, separado por una
    // línea en blanco — así se pueden combinar varias plantillas en la
    // misma Revisión (ej. Medidor + Sonda), igual que ya funciona con
    // Soluciones/Mediciones. Si a la plantilla le falta una sección, ese
    // campo se deja tal cual está.
    function cargarPlantillaDiagnostico(sufijo, secciones) {
        CAMPOS_DIAGNOSTICO.forEach(function(campo) {
            var el = document.getElementById(campo.idBase + sufijo);
            if (!el) return;
            var contenido = secciones[campo.clave];
            if (contenido === undefined) return;
            var actual = el.value.trim();
            el.value = actual ? (actual + '\n\n' + contenido) : contenido;
            dispararEventos(el);
        });
    }

    function crearSelectorPlantillaDiagnostico(sufijo) {
        // Contenedor completo: la fila con el <select> + botón, y debajo el
        // aviso de qué plantillas se han cargado hasta ahora en esta
        // Revisión. Se agrupan en un solo div para insertarlos juntos.
        var contenedorCompleto = document.createElement('div');
        contenedorCompleto.style.margin = '6px 0';
        contenedorCompleto.className = 'hanna-panel-inline';
        contenedorCompleto.dataset.hannaPlantillaBarraSufijo = sufijo;

        var barra = document.createElement('div');
        barra.style.display = 'flex';
        barra.style.alignItems = 'center';
        barra.style.gap = '6px';
        barra.style.fontFamily = 'Arial, sans-serif';

        // Antes era un <select> nativo con una lista fija en el código.
        // Ahora es el mismo combo-con-buscador que usan los paneles de
        // checkboxes, agrupado por categoría y construido en vivo desde la
        // pestaña "plantillas" del Sheet — agregar un tipo de equipo nuevo
        // ya no requiere tocar este archivo (ver sección 0c más arriba).
        var combo = crearComboBuscable(construirPlantillasAgrupadasDesdeSheet(), '#6f42c1', '📋 Elegir plantilla de diagnóstico…');
        combosPlantillasRef.push(combo);

        var botonCargar = document.createElement('button');
        botonCargar.type = 'button';
        botonCargar.innerText = '➕ Cargar';
        botonCargar.style.fontSize = '12px';
        botonCargar.style.padding = '5px 10px';
        botonCargar.style.borderRadius = '4px';
        botonCargar.style.border = '1px solid #6f42c1';
        botonCargar.style.color = '#fff';
        botonCargar.style.backgroundColor = '#6f42c1';
        botonCargar.style.cursor = 'pointer';

        // Línea chiquita debajo del selector que dice qué plantillas ya se
        // cargaron en esta Revisión (ej. "Se cargaron: Medidor HI 9XXXX,
        // Sonda pH/ISE/ORP/CE portátil"). Empieza oculta porque al insertar
        // el selector todavía no se ha cargado nada.
        var aviso = document.createElement('div');
        aviso.style.fontSize = '11px';
        aviso.style.color = '#6f42c1';
        aviso.style.marginTop = '4px';
        aviso.style.fontFamily = 'Arial, sans-serif';
        aviso.style.display = 'none';

        function actualizarAviso() {
            var lista = plantillasCargadasPorRevision[sufijo] || [];
            if (lista.length === 0) {
                aviso.style.display = 'none';
                return;
            }
            aviso.style.display = 'block';
            aviso.innerText = (lista.length > 1 ? 'Se cargaron: ' : 'Se cargó: ') + lista.join(', ');
        }

        botonCargar.onclick = function() {
            var clave = combo.obtenerValor();
            if (!clave) { alert('Elige una plantilla primero.'); return; }
            var plantilla = obtenerPlantillaPorClave(clave);
            if (!plantilla) return;

            // Ya no se pregunta "¿reemplazar?": cargar ahora AGREGA la
            // plantilla debajo de lo que ya haya (se pueden combinar varias
            // en la misma Revisión), en vez de borrar lo existente.
            botonCargar.disabled = true;
            var textoOriginalBoton = botonCargar.innerText;
            botonCargar.innerText = 'Cargando…';

            obtenerTextoPlantilla(plantilla, function(texto) {
                if (texto) {
                    cargarPlantillaDiagnostico(sufijo, parsearPlantilla(texto));
                    if (!plantillasCargadasPorRevision[sufijo]) plantillasCargadasPorRevision[sufijo] = [];
                    // Quita el emoji "🧪 " del inicio de la etiqueta para que
                    // el aviso se lea más limpio en texto corrido.
                    plantillasCargadasPorRevision[sufijo].push(plantilla.etiqueta.replace(/^\s*\S+\s*/, ''));
                    actualizarAviso();
                    // A propósito NO se limpia el combo después de cargar.
                    // Se deja la opción elegida visible en el botón para que
                    // el técnico vea a simple vista cuál fue la última
                    // plantilla que cargó.
                }
                botonCargar.disabled = false;
                botonCargar.innerText = textoOriginalBoton;
            });
        };

        barra.appendChild(combo.contenedor);
        barra.appendChild(botonCargar);
        contenedorCompleto.appendChild(barra);
        contenedorCompleto.appendChild(aviso);
        actualizarAviso(); // por si esta Revisión ya tenía plantillas cargadas (re-render)
        return contenedorCompleto;
    }

    // Busca todos los bloques de "Diagnóstico Preliminar" presentes AHORA
    // MISMO en la página (uno por cada Revisión activada) y le agrega su
    // propio selector de plantilla al que todavía no lo tenga.
    //
    // El chequeo de "¿ya existe una barra para esta Revisión?" se hace
    // buscando en TODO el documento una barra con ese mismo sufijo
    // (data-hanna-plantilla-barra-sufijo), en vez de confiar solo en una
    // bandera puesta sobre el campo de texto o en una variable en memoria.
    // Esto evita que se dupliquen las barras si el MutationObserver dispara
    // varias veces seguidas mientras se arma la página, o si algo (como un
    // editor enriquecido) reconstruye el campo de texto original.
    function intentarInyectarPlantillasDiagnostico() {
        var campos = document.querySelectorAll('[id^="' + ID_BASE_ESTADO_EXTERNO + '"]');
        campos.forEach(function(campoExterno) {
            var sufijo = campoExterno.id.slice(ID_BASE_ESTADO_EXTERNO.length);
            // Cada campo real tiene, además, un contenedor "hermano" cuyo id
            // es el mismo + "-wrapper" (ej. "...-estado-fisico-externo-1-wrapper"),
            // que TAMBIÉN empieza con el mismo prefijo y por lo tanto cae en
            // este querySelectorAll. Si no se filtra, ese wrapper se cuenta
            // como si fuera una Revisión aparte (sufijo "1-wrapper" en vez de
            // "1") y se le inserta su propia barra — de ahí salían 2 barras
            // por cada Revisión real. Una Revisión válida siempre es un
            // número puro.
            if (!sufijo || !/^\d+$/.test(sufijo)) return;

            // Resaltado de HTML: se intenta en cada pasada del observer.
            // envolverConResaltadoHTML no hace nada si el campo ya está
            // envuelto (o si todavía no es medible), así que repetir esto
            // no tiene costo y cubre campos que aparezcan más tarde.
            CAMPOS_DIAGNOSTICO.forEach(function(campoDef) {
                envolverConResaltadoHTML(document.getElementById(campoDef.idBase + sufijo));
            });

            var yaExiste = document.querySelector('[data-hanna-plantilla-barra-sufijo="' + sufijo + '"]');
            if (yaExiste) return;

            var barra = crearSelectorPlantillaDiagnostico(sufijo);
            var contenedor = campoExterno.closest('.form-item') || campoExterno.parentElement;
            if (!contenedor || !contenedor.parentNode) return;

            contenedor.parentNode.insertBefore(barra, contenedor);
        });
    }

    // Observer propio (nunca se desconecta): a diferencia de Mediciones/
    // Soluciones, aquí pueden aparecer Revisiones nuevas en cualquier momento
    // mientras el técnico trabaja en la página, así que hay que seguir
    // vigilando todo el tiempo. Es una operación barata (un solo
    // querySelectorAll por selector de atributo).
    var observadorDiagnostico = new MutationObserver(function() { intentarInyectarPlantillasDiagnostico(); });
    observadorDiagnostico.observe(document.body, { childList: true, subtree: true });
    intentarInyectarPlantillasDiagnostico();

    // Aviso único en consola (5s tras cargar) para depurar campos que nunca aparecieron.
    setTimeout(function() {
        var faltantes = [];
        if (Object.keys(controlesInyectados.iniciales).length === 0) faltantes.push(PREFIJO_MEDICIONES_INICIALES);
        if (Object.keys(controlesInyectados.finales).length === 0) faltantes.push(PREFIJO_MEDICIONES_FINALES);
        if (Object.keys(controlesInyectados.soluciones).length === 0) faltantes.push(PREFIJO_SOLUCIONES);
        if (!controlesInyectados.badge) faltantes.push('encabezado "Informe" (para la insignia de versión)');
        if (faltantes.length > 0) {
            console.warn('[Panel Hanna] No se encontraron todavía estos elementos en la página (puede ser normal si el "Tipo de Informe" aún no se seleccionó): ' + faltantes.join(', '));
        }
    }, 5000);

    // ------------------------------------------
    // INSIGNIA FIJA JUNTO AL ENCABEZADO "INFORME": versión + sincronización + respaldo
    // ------------------------------------------
    // A diferencia de las anteriores, esta insignia no flota sobre la página: se inserta
    // dentro del flujo normal del documento, justo debajo del encabezado "Informe".

    function encontrarEncabezadoInforme() {
        var encabezados = document.querySelectorAll('h1, h2, h3, h4, legend');
        for (var i = 0; i < encabezados.length; i++) {
            if (encabezados[i].textContent.trim() === 'Informe') return encabezados[i];
        }
        return null;
    }

    var badge = document.createElement('div');
    badge.style.display = 'flex';
    badge.style.flexDirection = 'column';
    badge.style.alignItems = 'flex-start';
    badge.style.gap = '4px';
    badge.style.margin = '6px 0 12px 0';
    badge.style.fontFamily = 'Arial, sans-serif';

    var btnBadge = document.createElement('button');
    btnBadge.type = 'button';
    btnBadge.innerText = '⚙️ Hanna v' + APP_VERSION;
    btnBadge.style.padding = '6px 10px';
    btnBadge.style.backgroundColor = '#0056b3';
    btnBadge.style.color = '#fff';
    btnBadge.style.border = 'none';
    btnBadge.style.borderRadius = '20px';
    btnBadge.style.cursor = 'pointer';
    btnBadge.style.fontSize = '11px';
    btnBadge.style.fontWeight = 'bold';
    btnBadge.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';

    var miniPanel = document.createElement('div');
    miniPanel.style.display = 'none';
    miniPanel.style.flexDirection = 'column';
    miniPanel.style.gap = '6px';
    miniPanel.style.backgroundColor = '#f8f9fa';
    miniPanel.style.padding = '10px';
    miniPanel.style.borderRadius = '8px';
    miniPanel.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    miniPanel.style.border = '1px solid #dee2e6';
    miniPanel.style.width = '260px';
    miniPanel.style.fontSize = '11px';

    var etiquetaSheetSync = document.createElement('div');
    etiquetaSheetSync.style.color = '#6c757d';
    miniPanel.appendChild(etiquetaSheetSync);

    function actualizarEtiquetaSheetSync() {
        var lineas = [];
        lineas.push(sheetUltimaActualizacion
            ? '🔄 Soluciones sincronizadas: ' + sheetUltimaActualizacion.toLocaleString()
            : '⚠️ Sin datos de Soluciones todavía.');
        lineas.push(sheetLecturasUltimaActualizacion
            ? '🔄 Mediciones sincronizadas: ' + sheetLecturasUltimaActualizacion.toLocaleString()
            : '⚠️ Sin datos de Mediciones todavía.');
        lineas.push(sheetPlantillasUltimaActualizacion
            ? '🔄 Plantillas sincronizadas: ' + sheetPlantillasUltimaActualizacion.toLocaleString()
            : '⚠️ Sin datos de Plantillas todavía.');
        etiquetaSheetSync.innerText = lineas.join(' · ');
    }

    function crearBtnMini(texto, color, accion) {
        var b = document.createElement('button');
        b.type = 'button';
        b.innerText = texto;
        b.style.padding = '5px 8px';
        b.style.backgroundColor = color;
        b.style.color = '#fff';
        b.style.border = 'none';
        b.style.borderRadius = '4px';
        b.style.cursor = 'pointer';
        b.style.fontSize = '11px';
        b.style.textAlign = 'left';
        b.onclick = accion;
        return b;
    }

    miniPanel.appendChild(crearBtnMini('🔄 Recargar datos del Sheet', '#6c757d', function() {
        var pendientes = 3;
        var todoOk = true;
        function terminado(ok) {
            todoOk = todoOk && ok;
            pendientes--;
            if (pendientes > 0) return;
            actualizarEtiquetaSheetSync();
            refrescarMenuSoluciones();
            refrescarMenuLecturas();
            refrescarComboPlantillas();
            alert(todoOk ? 'Soluciones, Mediciones y Plantillas actualizadas desde el Sheet.' : 'No se pudo conectar a alguna de las pestañas del Sheet. Se mantienen los últimos datos conocidos.');
        }
        cargarDatosSheet(terminado);
        cargarDatosLecturas(terminado);
        cargarDatosPlantillasSheet(terminado);
    }));
    miniPanel.appendChild(crearBtnMini('✏️ Abrir Sheet de lotes', '#28a745', abrirEditorSheet));

    var nota = document.createElement('div');
    nota.style.color = '#6c757d';
    nota.style.marginTop = '2px';
    nota.innerText = 'Los menús de autocompletar están justo encima de cada tabla del formulario.';
    miniPanel.appendChild(nota);

    btnBadge.onclick = function() {
        miniPanel.style.display = (miniPanel.style.display === 'none') ? 'flex' : 'none';
    };

    badge.appendChild(btnBadge);
    badge.appendChild(miniPanel);

    function intentarInyectarBadge() {
        if (controlesInyectados.badge) return;
        var encabezado = encontrarEncabezadoInforme();
        if (encabezado && encabezado.parentNode) {
            encabezado.parentNode.insertBefore(badge, encabezado.nextSibling);
            controlesInyectados.badge = true;
        }
    }

    // Carga inicial de Soluciones, Mediciones y Plantillas: primero lo que
    // quedó en caché (instantáneo), luego intenta refrescar cada pestaña del
    // Sheet en segundo plano. En los tres casos se refresca el panel/combo
    // correspondiente por si ya estaba inyectado. Plantillas, a diferencia
    // de las otras dos, ya arranca con datosPlantillasSheet lleno (las 5
    // plantillas por defecto, ver sección 0c), así que incluso sin caché ni
    // Sheet disponible el técnico ve algo para elegir.
    cargarCache();
    cargarCacheLecturas();
    cargarCachePlantillas();
    actualizarEtiquetaSheetSync();
    cargarDatosSheet(function() {
        actualizarEtiquetaSheetSync();
        refrescarMenuSoluciones();
    });
    cargarDatosLecturas(function() {
        actualizarEtiquetaSheetSync();
        refrescarMenuLecturas();
    });
    cargarDatosPlantillasSheet(function() {
        actualizarEtiquetaSheetSync();
        refrescarComboPlantillas();
    });

    // Primer intento de inyección (por si todo ya está en el DOM al cargar).
    intentarInyectarControles();

})();