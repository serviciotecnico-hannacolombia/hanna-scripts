// ==UserScript==
// @name         Panel Hanna - Informe de Mantenimiento
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Autocompletar Soluciones Estándar (mismo Google Sheet del panel de Diagnóstico) + contador de líneas y detección de errores de HTML en los campos de Resultados/Diagnóstico del Informe de Mantenimiento.
// @author       Brayan Galeano
// @match        https://intranet.hannacolombia.com/stecnico/item/*/maintenancereport
// @grant        none
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/panel-mantenimiento.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/panel-mantenimiento.user.js
// ==/UserScript==

// NOTA GENERAL: este script es una copia recortada de panel-hanna.user.js
// (el de la pestaña "Diagnóstico"), para la pestaña "Informe de Mantenimiento"
// (".../maintenancereport"). Trae SOLO dos cosas, tal como se pidió:
//
//   1. El mismo autocompletar de "Soluciones Estándar" (checklist con
//      buscador), leyendo la MISMA hoja de Google Sheets que ya usa el panel
//      de Diagnóstico — se comparte la caché local (misma CACHE_KEY), así que
//      si ya se cargó en esa pestaña, acá arranca con los mismos datos.
//   2. El contador de líneas + detección de errores de HTML (etiquetas sin
//      cerrar, cruzadas, etc.) en los 2 campos de texto de esta página
//      ("RM_resultados" y "RM_diagnostico").
//
// A propósito NO incluye: Mediciones Iniciales/Finales, ni Plantillas de
// Diagnóstico Preliminar por tipo de equipo (el usuario indicó que por ahora
// no se van a usar acá, aunque probablemente sí a futuro — cuando se
// necesiten, se agregan copiando esas secciones de panel-hanna.user.js).

(function() {
    'use strict';

    var APP_VERSION = '1.0';

    // ==========================================
    // 0. SOLUCIONES ESTÁNDAR DESDE GOOGLE SHEETS (100% dinámico)
    // ==========================================
    // Misma hoja, mismas columnas y MISMA CACHE_KEY que panel-hanna.user.js
    // (la pestaña de Diagnóstico): codigo | lote | vencimiento | parametro |
    // descripcion. Al compartir la CACHE_KEY, si el técnico ya abrió la
    // pestaña de Diagnóstico antes, esta página arranca de una con esos
    // mismos datos en caché (misma localStorage, mismo dominio).
    var SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT2t_Y1keodEQiK9Iv4C8PoYmkAe-dFDgVek2z4fAr9IACCV-XDzFvB8jnrBB6J5t4uUwgpwn2W9CSz/pub?gid=0&single=true&output=csv';
    var SHEET_EDIT_URL = 'https://docs.google.com/spreadsheets/d/1AzJX5B-myRtumple68r7ZXGpE7Xc3nLtkddG5i9rD98/edit?gid=0#gid=0';

    var CACHE_KEY = 'hanna_sheet_cache_v1';
    var datosSheet = [];
    var sheetUltimaActualizacion = null;

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
                return campos.map(function(v) { return v.replace(/\s*\n\s*/g, ' ').trim(); });
            })
            .filter(function(campos) { return campos.some(function(v) { return v !== ''; }); });
    }

    function aplicarFilasSheet(filas) {
        var nuevo = [];
        filas.forEach(function(campos) {
            var codigo = (campos[0] || '').trim();
            var lote = campos[1], venc = campos[2], parametro = campos[3], desc = campos[4];
            if (!codigo) return;
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
                console.warn('[Panel Mantenimiento] No se pudo leer el Sheet de lotes, usando último dato conocido / valores por defecto.', err);
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
    // 1. TABLA DE SOLUCIONES ESTÁNDAR EN ESTA PÁGINA
    // ==========================================
    // Confirmado (inspección real): el campo "Código" de esta tabla se llama
    // "RM_soluciones_codigo[]" — mismo criterio de nombres que la pestaña de
    // Diagnóstico, solo que con el prefijo "RM_" en vez de nada. No se
    // confirmaron los "name" exactos de Lote/Fecha de Expiración/Descripción,
    // pero NO hace falta saberlos: en vez de buscar por nombre, una vez
    // ubicada la tabla exacta (a partir del campo "Código"), se toman TODOS
    // los <input type="text"> que haya dentro de esa tabla — como la tabla
    // solo contiene esas 4 columnas, alcanza y sobra, sin depender de cómo se
    // llame cada campo.
    var PREFIJO_SOLUCIONES = 'RM_soluciones_codigo';
    var COLUMNAS_POR_SOLUCION = 4; // Código, Lote, Fecha de Expiración, Descripción (mismo orden visual de la tabla)

    function obtenerInputsSoluciones(alcance) {
        var raiz = alcance || document;
        return raiz.querySelectorAll('input[type="text"]');
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

    function borrarFilaSolucion(base, alcance) {
        var inputs = obtenerInputsSoluciones(alcance);
        for (var c = 0; c < COLUMNAS_POR_SOLUCION; c++) {
            if (inputs[base + c]) {
                inputs[base + c].value = '';
                dispararEventos(inputs[base + c]);
            }
        }
    }

    // Agrega, junto a cada fila de la tabla que tenga al menos un campo
    // lleno, un botón "✖" para borrar solo esa fila — y le activa a cada
    // campo el mismo resaltado/validación de HTML que los campos grandes
    // (ver sección 3), por si algún código/descripción trae HTML a mano.
    function inyectarBotonesLimpiarFila(alcance) {
        var inputs = obtenerInputsSoluciones(alcance);
        var totalFilas = Math.floor(inputs.length / COLUMNAS_POR_SOLUCION);

        for (var fila = 0; fila < totalFilas; fila++) {
            var base = fila * COLUMNAS_POR_SOLUCION;
            var inputsFila = [];
            for (var c = 0; c < COLUMNAS_POR_SOLUCION; c++) inputsFila.push(inputs[base + c]);

            var ultimoInput = inputsFila[COLUMNAS_POR_SOLUCION - 1];
            if (!ultimoInput || ultimoInput.dataset.hannaBotonFila) continue;
            ultimoInput.dataset.hannaBotonFila = '1';

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
    // 2. PANEL DE CHECKBOXES CON BUSCADOR (igual que panel-hanna.user.js)
    // ==========================================
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
        if (contenedor.previousElementSibling && contenedor.previousElementSibling.className === 'hanna-panel-inline') {
            return true;
        }
        contenedor.parentNode.insertBefore(elementoNuevo, contenedor);
        return true;
    }

    // Por si esta tabla también llegara a repetirse por "Revisión" (como en
    // Diagnóstico) — hoy con name="RM_soluciones_codigo[]" (sin número) cae
    // en una sola "Revisión 1", pero si el sitio cambia mañana y agrega
    // "[1]", "[2]"... esto lo detecta solo, sin tocar código.
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

    function normalizarTextoBusqueda(s) {
        return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

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

        var grupos = [];

        function poblar(opciones) {
            lista.innerHTML = '';
            grupos = [];
            buscador.value = '';
            if (!opciones || opciones.length === 0) {
                var vacio = document.createElement('div');
                vacio.style.color = '#6c757d';
                vacio.innerText = 'Todavía no hay datos del Sheet. Usa "🔄" o revisa que el Sheet tenga filas.';
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
                itemsDiv.style.display = 'none';
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

    var controlesInyectados = { soluciones: {} };
    var panelesSolucionesRef = [];

    function refrescarMenuSoluciones() {
        var opciones = construirOpcionesSolucionesDesdeSheet();
        panelesSolucionesRef.forEach(function(panel) { panel.poblar(opciones); });
    }

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

            var filaBotonesSol = panel.barra.firstChild;
            filaBotonesSol.appendChild(crearBotonIcono('🗑️', 'Borrar esta tabla de Soluciones Estándar', '#28a745', function() { borrarSolucionesSecuencial(tabla); }));
            filaBotonesSol.appendChild(crearBotonIcono('✏️', 'Abrir el Google Sheet de lotes/vencimientos', '#28a745', abrirEditorSheet));
            filaBotonesSol.appendChild(crearBotonIcono('🔄', 'Recargar datos del Sheet de Soluciones', '#28a745', function() {
                cargarDatosSheet(function(ok) {
                    refrescarMenuSoluciones();
                    alert(ok ? 'Soluciones actualizadas desde el Sheet.' : 'No se pudo conectar al Sheet. Se mantienen los últimos datos conocidos.');
                });
            }));

            if (anclarAntesDeTabla(refCampo, panel.barra)) {
                controlesInyectados.soluciones[rev] = true;
                inyectarBotonesLimpiarFila(tabla);
            }
        });
    }

    // ==========================================
    // 3. CONTADOR DE LÍNEAS + DETECCIÓN DE ERRORES DE HTML
    // ==========================================
    // Idéntico al de panel-hanna.user.js v16.17 (con la corrección de
    // alineación en párrafos largos incluida desde el principio en esta
    // copia).
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

    var PROPIEDADES_A_COPIAR_RESALTADO = [
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
        'letterSpacing', 'wordSpacing', 'textIndent', 'textAlign', 'direction',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
        'boxSizing', 'tabSize'
    ];

    var ANCHO_REGLA = 32;

    function asegurarEstiloOcultarScrollCapa() {
        if (document.getElementById('hanna-resaltado-estilos')) return;
        var tag = document.createElement('style');
        tag.id = 'hanna-resaltado-estilos';
        tag.textContent = '.hanna-resaltado-capa{scrollbar-width:none;-ms-overflow-style:none;}' +
            '.hanna-resaltado-capa::-webkit-scrollbar{display:none;width:0;height:0;}';
        document.head.appendChild(tag);
    }

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

    function sincronizarReglaConCampo(campo, regla) {
        regla.style.left = campo.offsetLeft + 'px';
        regla.style.top = campo.offsetTop + 'px';
        regla.style.height = campo.offsetHeight + 'px';
    }

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
        regla.style.pointerEvents = 'none';
        regla.style.fontFamily = estilo.fontFamily;
        regla.style.fontSize = estilo.fontSize;
        regla.style.lineHeight = estilo.lineHeight;
        return regla;
    }

    function crearMedidorLineas(estilo) {
        var medidor = document.createElement('div');
        medidor.className = 'hanna-resaltado-medidor';
        medidor.setAttribute('aria-hidden', 'true');
        medidor.style.position = 'absolute';
        medidor.style.visibility = 'hidden';
        medidor.style.left = '0';
        medidor.style.top = '0';
        medidor.style.height = 'auto';
        medidor.style.margin = '0';
        medidor.style.overflow = 'visible';
        medidor.style.whiteSpace = 'pre-wrap';
        medidor.style.wordWrap = 'break-word';
        medidor.style.pointerEvents = 'none';
        PROPIEDADES_A_COPIAR_RESALTADO.forEach(function(prop) { medidor.style[prop] = estilo[prop]; });
        return medidor;
    }

    function actualizarRegla(campo, regla, medidor) {
        var lineas = campo.value.split('\n');

        medidor.style.width = campo.offsetWidth + 'px';
        var marcado = [];
        for (var i = 0; i < lineas.length; i++) {
            marcado.push('<span class="hanna-marca-linea">​</span>' + escaparHTML(lineas[i]));
        }
        medidor.innerHTML = marcado.join('\n');

        var marcas = medidor.getElementsByClassName('hanna-marca-linea');
        var medidorTop = medidor.getBoundingClientRect().top;
        var html = '';
        for (var j = 0; j < marcas.length; j++) {
            var offset = marcas[j].getBoundingClientRect().top - medidorTop;
            html += '<div style="position:absolute;left:0;right:4px;top:' + offset +
                'px;text-align:right;white-space:nowrap;overflow:hidden;">' + (j + 1) + '</div>';
        }
        regla.innerHTML = html;
    }

    function sincronizarAvisoConCampo(campo, aviso) {
        aviso.style.left = campo.offsetLeft + 'px';
        aviso.style.top = (campo.offsetTop + campo.offsetHeight + 3) + 'px';
    }

    function observarGeometria(campo, sincronizar) {
        sincronizar();
        if (window.ResizeObserver) new ResizeObserver(sincronizar).observe(campo);
        window.addEventListener('resize', sincronizar);
    }

    function activarResaltadoCompleto(campo) {
        asegurarEstiloOcultarScrollCapa();
        var padre = asegurarContenedorPosicionado(campo);
        if (!padre) return;

        var estilo = window.getComputedStyle(campo);
        var colorOriginalTexto = estilo.color;
        var fondoOriginal = estilo.backgroundColor;

        var paddingIzquierdoOriginalPx = parseFloat(estilo.paddingLeft) || 0;
        campo.style.boxSizing = 'border-box';
        campo.style.paddingLeft = (paddingIzquierdoOriginalPx + ANCHO_REGLA) + 'px';

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

        campo.style.position = 'relative';
        campo.style.zIndex = '1';
        campo.style.background = 'transparent';
        campo.style.color = 'transparent';
        campo.style.webkitTextFillColor = 'transparent';
        campo.style.caretColor = (colorOriginalTexto && colorOriginalTexto.indexOf('rgba(0, 0, 0, 0)') === -1 && colorOriginalTexto !== 'transparent') ? colorOriginalTexto : '#000';

        var regla = crearRegla(estilo, fondoOriginal);
        padre.insertBefore(regla, campo);

        var medidor = crearMedidorLineas(estilo);
        padre.appendChild(medidor);

        var aviso = crearAvisoFlotante();
        padre.appendChild(aviso);

        function sincronizarGeometria() {
            sincronizarCapaConCampo(campo, capa);
            sincronizarReglaConCampo(campo, regla);
            sincronizarAvisoConCampo(campo, aviso);
            actualizarRegla(campo, regla, medidor);
        }

        function actualizar() {
            capa.innerHTML = generarHTMLResaltado(campo.value, true);
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

    // ==========================================
    // 4. ARRANQUE
    // ==========================================
    // Los dos campos grandes de esta página son <textarea id="RM_resultados">
    // y <textarea id="RM_diagnostico"> (confirmado por inspección). El
    // selector busca por "empieza con" (no por igualdad exacta) para seguir
    // funcionando sola si el sitio llegara a repetir estos campos con un
    // sufijo (ej. "RM_resultados-1", "RM_resultados[2]") como ya pasa con los
    // 5 campos de Diagnóstico Preliminar en la otra pestaña.
    function activarResaltadoCampos() {
        var campos = document.querySelectorAll(
            'textarea[id^="RM_resultados"], textarea[name^="RM_resultados"], ' +
            'textarea[id^="RM_diagnostico"], textarea[name^="RM_diagnostico"]'
        );
        campos.forEach(function(campo) { envolverConResaltadoHTML(campo); });
    }

    function intentarInyectarControles() {
        inyectarPanelesSoluciones();
        activarResaltadoCampos();
    }

    // El formulario de esta página también puede tardar en renderizar sus
    // tablas/campos, así que un MutationObserver reintenta hasta lograrlo
    // (igual criterio que panel-hanna.user.js).
    var observadorDOM = new MutationObserver(function() { intentarInyectarControles(); });
    observadorDOM.observe(document.body, { childList: true, subtree: true });

    cargarCache();
    cargarDatosSheet(function() {
        refrescarMenuSoluciones();
    });

    intentarInyectarControles();

})();
