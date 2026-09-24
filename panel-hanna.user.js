// ==UserScript==
// @name         Panel de Control Intranet Hanna
// @namespace    http://tampermonkey.net/
// @version      16.3
// @description  Panel completo: Mediciones/Soluciones 100% dinámicas desde Google Sheets, marcador de resultado (✔/✘/Inestable), y plantillas de Diagnóstico Preliminar por tipo de equipo desde GitHub
// @author       Brayan Galeano
// @match        https://intranet.hannacolombia.com/stecnico/item/*/diagnosis
// @grant        none
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/panel-hanna.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/panel-hanna.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Debe coincidir siempre con @version del header de arriba.
    var APP_VERSION = '16.3';

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

    // "prefijoNombre" es el prefijo exacto de "name" para UNA Revisión en
    // particular (ej. "soluciones_codigo[2]"), no el prefijo genérico —
    // así cada Revisión edita solo sus propios campos, nunca los de otra.
    function obtenerInputsSoluciones(prefijoNombre) {
        var prefijo = prefijoNombre || PREFIJO_SOLUCIONES;
        var inputs = document.querySelectorAll('input[name^="' + prefijo + '"]');
        if (inputs.length === 0 && !prefijoNombre) inputs = document.querySelectorAll('input[type="text"]');
        return inputs;
    }

    function dispararEventos(input) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function agregarSolucionSecuencial(prefijoNombre, datosFila) {
        var inputs = obtenerInputsSoluciones(prefijoNombre);
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

    function borrarSolucionesSecuencial(prefijoNombre) {
        var inputs = obtenerInputsSoluciones(prefijoNombre);
        for (var i = 0; i < inputs.length; i++) {
            inputs[i].value = '';
            dispararEventos(inputs[i]);
        }
    }

    // Borra solo los 4 campos de UNA fila (código, lote, vencimiento,
    // descripción), identificada por el índice de su primer campo.
    function borrarFilaSolucion(prefijoNombre, base) {
        var inputs = obtenerInputsSoluciones(prefijoNombre);
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
    function inyectarBotonesLimpiarFila(prefijoNombre) {
        var inputs = obtenerInputsSoluciones(prefijoNombre);
        var totalFilas = Math.floor(inputs.length / COLUMNAS_POR_SOLUCION);

        for (var fila = 0; fila < totalFilas; fila++) {
            var base = fila * COLUMNAS_POR_SOLUCION;
            var inputsFila = [];
            for (var c = 0; c < COLUMNAS_POR_SOLUCION; c++) inputsFila.push(inputs[base + c]);

            var ultimoInput = inputsFila[COLUMNAS_POR_SOLUCION - 1];
            if (!ultimoInput || ultimoInput.dataset.hannaBotonFila) continue; // ya tiene botón
            ultimoInput.dataset.hannaBotonFila = '1';

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
                    borrarFilaSolucion(prefijoNombre, baseFila);
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

    // Panel de checkboxes para elegir varios ítems de una lista de una vez
    // (en vez de un <select> que se aplica al primer clic). El técnico marca
    // los que usó, agrupados por categoría/parámetro, y los carga todos
    // juntos con un botón — cada uno cae en la primera fila vacía de su
    // tabla, así que si ya había algo cargado, lo nuevo se agrega debajo sin
    // borrarlo. Se reutiliza tanto para Soluciones Estándar como para
    // Mediciones Iniciales/Finales.
    function crearPanelChecklist(opcionesIniciales, colorBorde, textoBotonAbrir, onCargarSeleccionadas) {
        var barra = document.createElement('div');
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
        panel.style.maxWidth = '420px';
        panel.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        panel.style.fontSize = '12px';

        var lista = document.createElement('div');
        lista.style.display = 'flex';
        lista.style.flexDirection = 'column';
        lista.style.gap = '10px';
        lista.style.maxHeight = '260px';
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

        function poblar(opciones) {
            lista.innerHTML = '';
            if (!opciones || opciones.length === 0) {
                var vacio = document.createElement('div');
                vacio.style.color = '#6c757d';
                vacio.innerText = 'Todavía no hay datos del Sheet. Usa "🔄 Recargar datos del Sheet" o revisa que el Sheet tenga filas.';
                lista.appendChild(vacio);
                return;
            }
            opciones.forEach(function(grupo) {
                var titulo = document.createElement('div');
                titulo.innerText = grupo.categoria;
                titulo.style.fontWeight = 'bold';
                titulo.style.color = '#495057';
                titulo.style.borderBottom = '1px solid #dee2e6';
                titulo.style.paddingBottom = '2px';
                lista.appendChild(titulo);

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
                    lista.appendChild(label);
                });
            });
        }

        poblar(opcionesIniciales);

        botonAbrir.onclick = function() {
            panel.style.display = (panel.style.display === 'none') ? 'flex' : 'none';
        };

        function cerrarYLimpiarSeleccion() {
            panel.style.display = 'none';
            [].slice.call(lista.querySelectorAll('input[type="checkbox"]')).forEach(function(cb) { cb.checked = false; });
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

    // Igual que inyectarPanelesLecturas, pero para Soluciones Estándar
    // (4 columnas por fila en vez de 3, y sus propios botones ✖/✏️).
    function inyectarPanelesSoluciones() {
        var prefijosPorRevision = extraerPrefijosPorRevision(PREFIJO_SOLUCIONES);
        var revisiones = Object.keys(prefijosPorRevision);
        var multiplesRevisiones = revisiones.length > 1;

        revisiones.forEach(function(rev) {
            if (controlesInyectados.soluciones[rev]) return;
            var prefijoRevision = prefijosPorRevision[rev];
            var refCampo = document.querySelector('input[name^="' + prefijoRevision + '"]');
            if (!refCampo) return;

            var etiqueta = multiplesRevisiones ? ('🧴 Elegir Soluciones Estándar… (Revisión ' + rev + ')') : '🧴 Elegir Soluciones Estándar…';
            var panel = crearPanelChecklist(construirOpcionesSolucionesDesdeSheet(), '#28a745', etiqueta, function(clavesSeleccionadas) {
                clavesSeleccionadas.forEach(function(clave) {
                    var fila = datosSheet[Number(clave)];
                    if (!fila) return;
                    agregarSolucionSecuencial(prefijoRevision, [fila.codigo, fila.lote, fila.venc, fila.desc]);
                });
            });
            panelesSolucionesRef.push(panel);

            var filaBotonesSol = panel.barra.firstChild; // la fila con el botón "Elegir…"
            filaBotonesSol.appendChild(crearBotonIcono('🗑️', 'Borrar esta tabla de Soluciones Estándar', '#28a745', function() { borrarSolucionesSecuencial(prefijoRevision); }));
            filaBotonesSol.appendChild(crearBotonIcono('✏️', 'Abrir el Google Sheet de lotes/vencimientos', '#28a745', abrirEditorSheet));

            if (anclarAntesDeTabla(refCampo, panel.barra)) {
                controlesInyectados.soluciones[rev] = true;
                inyectarBotonesLimpiarFila(prefijoRevision);
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

    var PLANTILLAS_DIAGNOSTICO = [
        { clave: 'tester_ph_orp_ce', etiqueta: '🧪 Tester pH/ORP/CE (HI 9XXXX)', url: GITHUB_PLANTILLAS_BASE + 'tester-ph-orp-ce.txt' },
        { clave: 'multiparametro_sobremesa', etiqueta: '🧪 Multiparámetro de sobremesa', url: GITHUB_PLANTILLAS_BASE + 'multiparametro-sobremesa.txt' },
        { clave: 'multiparametro_portatil', etiqueta: '🧪 Multiparámetro portátil (HI 98XXX)', url: GITHUB_PLANTILLAS_BASE + 'multiparametro-portatil.txt' },
        { clave: 'ph_ise_orp_ce_portatil', etiqueta: '🧪 pH/ISE/ORP/CE portátil', url: GITHUB_PLANTILLAS_BASE + 'ph-ise-orp-ce-portatil.txt' },
        { clave: 'oximetro_portatil', etiqueta: '🧪 Oxímetro portátil', url: GITHUB_PLANTILLAS_BASE + 'oximetro-portatil.txt' }
    ];

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
        var cacheKey = 'hanna_plantilla_cache_' + plantilla.clave;
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

    // ¿Ya hay algo escrito en alguno de los 5 campos de esta Revisión?
    function algunCampoDiagnosticoTieneContenido(sufijo) {
        return CAMPOS_DIAGNOSTICO.some(function(campo) {
            var el = document.getElementById(campo.idBase + sufijo);
            return el && el.value.trim() !== '';
        });
    }

    // Reemplaza (no acumula) el contenido de los 5 campos de la Revisión
    // "sufijo" con lo que traiga cada sección de la plantilla. Si a la
    // plantilla le falta una sección, ese campo se deja tal cual está.
    function cargarPlantillaDiagnostico(sufijo, secciones) {
        CAMPOS_DIAGNOSTICO.forEach(function(campo) {
            var el = document.getElementById(campo.idBase + sufijo);
            if (!el) return;
            var contenido = secciones[campo.clave];
            if (contenido === undefined) return;
            el.value = contenido;
            dispararEventos(el);
        });
    }

    function crearSelectorPlantillaDiagnostico(sufijo) {
        var barra = document.createElement('div');
        barra.style.display = 'flex';
        barra.style.alignItems = 'center';
        barra.style.gap = '6px';
        barra.style.margin = '6px 0';
        barra.style.fontFamily = 'Arial, sans-serif';
        barra.className = 'hanna-panel-inline';

        var select = document.createElement('select');
        select.style.fontSize = '12px';
        select.style.padding = '4px 6px';
        select.style.borderRadius = '4px';
        select.style.border = '1px solid #6f42c1';
        select.style.color = '#495057';
        select.style.backgroundColor = '#fff';
        select.style.maxWidth = '320px';

        var optPlaceholder = document.createElement('option');
        optPlaceholder.textContent = '📋 Elegir plantilla de diagnóstico…';
        optPlaceholder.value = '';
        optPlaceholder.disabled = true;
        optPlaceholder.selected = true;
        select.appendChild(optPlaceholder);

        PLANTILLAS_DIAGNOSTICO.forEach(function(plantilla) {
            var op = document.createElement('option');
            op.textContent = plantilla.etiqueta;
            op.value = plantilla.clave;
            select.appendChild(op);
        });

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

        botonCargar.onclick = function() {
            var clave = select.value;
            if (!clave) { alert('Elige una plantilla primero.'); return; }
            var plantilla = PLANTILLAS_DIAGNOSTICO.filter(function(p) { return p.clave === clave; })[0];
            if (!plantilla) return;

            if (algunCampoDiagnosticoTieneContenido(sufijo)) {
                var seguro = confirm('Ya hay texto escrito en algunos de los campos de esta Revisión. ¿Reemplazarlo con la plantilla "' + plantilla.etiqueta + '"?');
                if (!seguro) return;
            }

            botonCargar.disabled = true;
            var textoOriginalBoton = botonCargar.innerText;
            botonCargar.innerText = 'Cargando…';

            obtenerTextoPlantilla(plantilla, function(texto) {
                if (texto) {
                    cargarPlantillaDiagnostico(sufijo, parsearPlantilla(texto));
                    // Ojo: a propósito NO se limpia el <select> (select.value = '')
                    // después de cargar. Se deja la opción elegida visible para que
                    // el técnico vea a simple vista cuál plantilla quedó cargada en
                    // esta Revisión.
                }
                botonCargar.disabled = false;
                botonCargar.innerText = textoOriginalBoton;
            });
        };

        barra.appendChild(select);
        barra.appendChild(botonCargar);
        // Marca la propia barra con el sufijo de Revisión al que pertenece.
        // Esto es lo que se usa para detectar duplicados (ver más abajo),
        // en vez de una bandera puesta sobre el campo de texto: así funciona
        // aunque el campo termine siendo reemplazado por otro nodo del DOM
        // (por ejemplo si un editor de texto enriquecido lo reconstruye).
        barra.dataset.hannaPlantillaBarraSufijo = sufijo;
        return barra;
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
            if (!sufijo) return;

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
        var pendientes = 2;
        var todoOk = true;
        function terminado(ok) {
            todoOk = todoOk && ok;
            pendientes--;
            if (pendientes > 0) return;
            actualizarEtiquetaSheetSync();
            refrescarMenuSoluciones();
            refrescarMenuLecturas();
            alert(todoOk ? 'Soluciones y Mediciones actualizadas desde el Sheet.' : 'No se pudo conectar a alguna de las pestañas del Sheet. Se mantienen los últimos datos conocidos.');
        }
        cargarDatosSheet(terminado);
        cargarDatosLecturas(terminado);
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

    // Carga inicial de Soluciones y Mediciones: primero lo que quedó en
    // caché (instantáneo), luego intenta refrescar cada pestaña del Sheet en
    // segundo plano. En ambos casos se refresca el panel correspondiente por
    // si ya estaba inyectado.
    cargarCache();
    cargarCacheLecturas();
    actualizarEtiquetaSheetSync();
    cargarDatosSheet(function() {
        actualizarEtiquetaSheetSync();
        refrescarMenuSoluciones();
    });
    cargarDatosLecturas(function() {
        actualizarEtiquetaSheetSync();
        refrescarMenuLecturas();
    });

    // Primer intento de inyección (por si todo ya está en el DOM al cargar).
    intentarInyectarControles();

})();