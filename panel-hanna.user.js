// ==UserScript==
// @name         Panel de Control Intranet Hanna
// @namespace    http://tampermonkey.net/
// @version      13.3
// @description  Panel completo con mediciones, patrones de T° y 3 estándares para turbidez HI93703
// @author       Brayan Galeano
// @match        https://intranet.hannacolombia.com/stecnico/item/*/diagnosis
// @grant        none
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/panel-hanna.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/panel-hanna.user.js
// ==/UserScript==

(function() {
    'use strict';

    // Debe coincidir siempre con @version del header de arriba.
    var APP_VERSION = '13.3';

    var columnasPorFilaLecturas = 3;

    // ==========================================
    // 0. LOTES Y VENCIMIENTOS DESDE GOOGLE SHEETS
    // ==========================================
    // La hoja debe tener, en este orden, las columnas: codigo | lote | vencimiento
    // (con encabezado en la fila 1). El "codigo" debe coincidir exacto con los
    // códigos usados abajo (HI7004L, HI7031L, etc).
    //
    // Cómo obtener las dos URLs de abajo:
    //  1. SHEET_CSV_URL: en el Sheet -> Archivo -> Compartir -> Publicar en la web
    //     -> elige la hoja correcta -> formato CSV -> copia el link.
    //  2. SHEET_EDIT_URL: la URL normal del Sheet (la que usas para editarlo),
    //     la que abre el botón "✏️ Editar en Sheets" del panel.

    var SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT2t_Y1keodEQiK9Iv4C8PoYmkAe-dFDgVek2z4fAr9IACCV-XDzFvB8jnrBB6J5t4uUwgpwn2W9CSz/pub?gid=0&single=true&output=csv';
    var SHEET_EDIT_URL = 'https://docs.google.com/spreadsheets/d/1AzJX5B-myRtumple68r7ZXGpE7Xc3nLtkddG5i9rD98/edit?gid=0#gid=0';

    var CACHE_KEY = 'hanna_sheet_cache_v1';
    var datosSheet = {};       // { "HI7004L": { lote: "2459", venc: "11/2030" }, ... }
    var sheetUltimaActualizacion = null;

    // Parser CSV simple (soporta campos entre comillas con comas dentro).
    function parseCSV(texto) {
        var filas = texto.replace(/\r/g, '').split('\n').filter(function(l) { return l.trim() !== ''; });
        return filas.slice(1).map(function(linea) { // slice(1) = salta encabezado
            var campos = [];
            var actual = '';
            var dentroComillas = false;
            for (var i = 0; i < linea.length; i++) {
                var c = linea[i];
                if (c === '"') { dentroComillas = !dentroComillas; }
                else if (c === ',' && !dentroComillas) { campos.push(actual); actual = ''; }
                else { actual += c; }
            }
            campos.push(actual);
            return campos.map(function(v) { return v.trim(); });
        });
    }

    function aplicarFilasSheet(filas) {
        var nuevo = {};
        filas.forEach(function(campos) {
            var codigo = campos[0], lote = campos[1], venc = campos[2];
            if (codigo) nuevo[codigo] = { lote: lote || '', venc: venc || '' };
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

    function getLote(codigo, defecto) {
        return (datosSheet[codigo] && datosSheet[codigo].lote) || defecto;
    }

    function getVenc(codigo, defecto) {
        return (datosSheet[codigo] && datosSheet[codigo].venc) || defecto;
    }

    function abrirEditorSheet() {
        if (!SHEET_EDIT_URL || SHEET_EDIT_URL.indexOf('PEGA_AQUI') === 0) {
            alert('Todavía no se configuró la URL del Sheet de lotes en el script.');
            return;
        }
        window.open(SHEET_EDIT_URL, '_blank');
    }


    // ==========================================
    // 1. BANCO DE DATOS
    // ==========================================

      var lecturas = {
        // pH solo
        ph_temp_1dec: ["7.0 pH", "7.0 ± 0.1 pH @25°C", "±0.2 pH", "4.0 pH", "4.0 ± 0.1 pH @25°C", "±0.2 pH", "10.0 pH", "10.0 ± 0.1 pH @25°C", "±0.2 pH", "25.0°C", "25.0 °C", "±0.7 °C"],
        ph_temp_2dec: ["7.01 pH", "7.01 ± 0.01 pH @25°C", "±0.05 pH", "4.01 pH", "4.01 ± 0.01 pH @25°C", "±0.05 pH", "10.01 pH", "10.01 ± 0.01 pH @25°C", "±0.05 pH", "25.0°C", "25.0 °C", "±0.7 °C"],
        ph_mv_temp: ["7.01 pH(0.0mV)", "7.01 pH @25°C (0±30mV )", "±30mV", "4.01 pH(177.4mV)", "4.01 pH @25°C (177.48mV )", "85% a 105%", "10.01 pH(-177.4mV)", "10.01 pH @25°C (-177.48mV )", "85% a 105%", "25.0°C", "25.0 °C", "±0.7 °C"],

        // Conductividad solo
        cond_us: ["0 uS/cm", "0 uS/cm @25°C", "±2.0% F.S","1413 uS/cm", "1413±5 uS/cm @25°C", "±2.0% F.S", "25.0°C", "25.0 °C", "±0.7 °C"],
        cond_ms: ["0 mS/cm", "0 mS/cm @25°C", "±2.0% F.S","12.88 mS/cm", "12880±50 uS/cm @25°C", "±2.0% F.S", "25.0°C", "25.0 °C", "±0.7 °C"],
        cond_potenciometrica: ["0 uS/cm", "0 uS/cm @25°C", "±2 de la lectura o lo que sea mayor.","1413 uS/cm", "1413±5 uS/cm @25°C","±2 de la lectura o lo que sea mayor.","12.88 mS/cm", "12880±50 uS/cm @25°C", "±2 de la lectura o lo que sea mayor.", "25.0°C", "25.0 °C", "±0.7 °C"],

        // Oxígeno solo
        oxigeno: ["0.0 % OD", "0% ± 0.1 OD @25°C", "<10 % OD","100 % OD", "100% OD @25°C", "90-120 % OD", "25.0°C", "25.0 °C", "±0.7 °C"],

        // Combinados pH + Conductividad (uS/cm)
        ph_cond_us_temp_1dec: ["7.0 pH", "7.0 ± 0.1 pH @25°C", "±0.2 pH", "4.0 pH", "4.0 ± 0.1 pH @25°C", "±0.2 pH", "10.0 pH", "10.0 ± 0.1 pH @25°C", "±0.2 pH","0 uS/cm", "0 uS/cm @25°C", "±2.0% F.S","1413 uS/cm", "1413±5 uS/cm @25°C", "±2.0% F.S", "25.0°C", "25.0 °C", "±0.7 °C"],
        ph_cond_us_temp_2dec: ["7.01 pH", "7.01 ± 0.01 pH @25°C", "±0.05 pH", "4.01 pH", "4.01 ± 0.01 pH @25°C", "±0.05 pH", "10.01 pH", "10.01 ± 0.01 pH @25°C", "±0.05 pH","0 uS/cm", "0 uS/cm @25°C", "±2.0% F.S","1413 uS/cm", "1413±5 uS/cm @25°C", "±2.0% F.S", "25.0°C", "25.0 °C", "±0.7 °C"],

        // Combinados pH + Conductividad (mS/cm)
        ph_cond_ms_temp_1dec: ["7.0 pH", "7.0 ± 0.1 pH @25°C", "±0.2 pH", "4.0 pH", "4.0 ± 0.1 pH @25°C", "±0.2 pH", "10.0 pH", "10.0 ± 0.1 pH @25°C", "±0.2 pH","0 mS/cm", "0 mS/cm @25°C", "±2.0% F.S","12.88 mS/cm", "12880±50 uS/cm @25°C", "±2.0% F.S", "25.0°C", "25.0 °C", "±0.7 °C"],
        ph_cond_ms_temp_2dec: ["7.01 pH", "7.01 ± 0.01 pH @25°C", "±0.05 pH", "4.01 pH", "4.01 ± 0.01 pH @25°C", "±0.05 pH", "10.01 pH", "10.01 ± 0.01 pH @25°C", "±0.05 pH","0 mS/cm", "0 mS/cm @25°C", "±2.0% F.S","12.88 mS/cm", "12880±50 uS/cm @25°C", "±2.0% F.S", "25.0°C", "25.0 °C", "±0.7 °C"],

        // Combinados pH + Oxígeno
        ph_oxigeno_temp: ["7.01 pH(0.0mV)", "7.01 pH @25°C (0±30mV )", "±30mV", "4.01 pH(177.4mV)", "4.01 pH @25°C (177.48mV )", "85% a 105%", "10.01 pH(-177.4mV)", "10.01 pH @25°C (-177.48mV )", "85% a 105%","0.0 % OD", "0% ± 0.1 OD @25°C", "<10 % OD","100 % OD", "100% OD @25°C", "90-120 % OD", "25.0°C", "25.0 °C", "±0.7 °C"],

        // Multiparámetros
        multi_completo: ["7.01 pH(0.0mV)", "7.01 pH @25°C (0±30mV )", "±30mV", "4.01 pH(177.4mV)", "4.01 pH @25°C (177.48mV )", "85% a 105%", "10.01 pH(-177.4mV)", "10.01 pH @25°C (-177.48mV )", "85% a 105%","0.0 % OD", "0% ± 0.1 OD @25°C", "<10 % OD","100 % OD", "100% OD @25°C", "90-120 % OD","0 uS/cm", "0 uS/cm @25°C", "±2 de la lectura o lo que sea mayor.","1413 uS/cm", "1413±5 uS/cm @25°C","±2 de la lectura o lo que sea mayor.","12.88 mS/cm", "12880±50 uS/cm @25°C", "±2 de la lectura o lo que sea mayor.", "25.0°C", "25.0 °C", "±0.7 °C"],

        // Fotometría, Espectrofotometría y Absorbancia
        foto_cloro_ph: ["7.0 pH", "7.0 pH", "±0.2 pH","1.01 mg/L", "1.00 ± 0.03mg/L CL2 F @25°C", "±0.03 mg/L ±3% de lectura","1.01 mg/L", "1.00 ± 0.03mg/L CL2 T @25°C", "±0.03 mg/L ±3% de lectura "],
        foto_hi97xx_cloro: ["0.0 mg/L", "0 ± CL2 F @25°C", "±0.03 mg/L ±3% de lectura","1.01 mg/L", "1.00 ± 0.03mg/L CL2 F @25°C", "±0.03 mg/L ±3% de lectura"],
        espectrofotometria: ["361.1nm", "359.6 a 362.6 abs ±1.5 nm", "359.6 a 362.6 abs ±1.5 nm", "446.2nm", "444.7 a 447.7 abs ±1.5 nm", "444.7 a 447.7 abs ±1.5 nm","536.5nm","535.0 a 538.0 abs ±1.5 nm","535.0 a 538.0 abs ±1.5 nm","637.5nm","636.0 a 639.0 abs ±1.5 nm","636.0 a 639.0 abs ±1.5 nm" ],
        absorbancia: ["1.00 abs", "420nm   1.00 abs", "± 0.02 @25°C + 0.003 abs","1.00 abs", "466nm   1.00 abs", "± 0.02 @25°C + 0.003 abs","1.00 abs", "525nm   1.00 abs", "± 0.02 @25°C + 0.003 abs","1.00 abs", "575nm   1.00 abs", "± 0.02 @25°C + 0.003 abs","1.00 abs", "610nm   1.00 abs", "± 0.02 @25°C + 0.003 abs"],

        // Checkers Separados
        checker_cloro_libre: ["0.00 ppm", "0.00 ppm @25°C","±0.03 ppm ±3% de lectura","1.00 ppm", "1.00 ±0.05 ppm @25°C","±0.03 ppm ±3% de lectura"],
        checker_cloro_total: ["1.50 ppm", "OK"],
        checker_hierro: ["0.00 ppm", "0.00 ppm @25°C","±0.03 ppm ±3% de lectura","1.00 ppm", "1.00 ±0.05 ppm @25°C","±0.03 ppm ±3% de lectura"],
        checker_color: ["0.00 PCU", "0.00 PCU @25°C","±10 PCU±5% de lectura","155 PCU", "150 ±15 PCU @25°C","±10 PCU±5% de lectura "],

        // Turbidez
        turbi_hi93703: ["0.0 FTU", "0.0 FTU @25°C < 0.1", "±5%  F.S. (0 a 10 FTU)","10.00 FTU", "10.00 FTU @25°C ± 0.20 ", "±10% F.S. (10 a 50 FTU)","501 FTU", "500 FTU @25°C ± 10", "±5%  F.S. (50 a 1000 FTU)"],
        turbi_hi98703: ["0.10 NTU", "0.10 NTU@25°C", "±2% o 0.02 NTU lo que sea >","15.0 NTU", "15.0 NTU@25°C", "±2% o 0.02 NTU lo que sea >","100 NTU", "100 NTU@25°C", "±2% o 0.02 NTU lo que sea >","750 NTU", "750 NTU@25°C", "±2% o 0.02 NTU lo que sea >"]
    };

    // SOLUCIONES ESTÁNDAR (Dinámicas por Lote)
    function obtenerSoluciones() {
        return {
            ph: [
                "HI7004L", getLote("HI7004L", "L0001"), getVenc("HI7004L", "2028-01"), "Buffer pH 4.01",
                "HI7007L", getLote("HI7007L", "L0002"), getVenc("HI7007L", "2028-01"), "Buffer pH 7.01",
                "HI7010L", getLote("HI7010L", "L0003"), getVenc("HI7010L", "2028-01"), "Buffer pH 10.01"
            ],
            cond_us: [
                "HI7031L", getLote("HI7031L", "C0001"), getVenc("HI7031L", "2028-01"), "Conductividad 1413 uS/cm",
                "HI7033L", getLote("HI7033L", "C0002"), getVenc("HI7033L", "2028-01"), "Conductividad 84 uS/cm"
            ],
            cond_ms: [
                "HI7030L", getLote("HI7030L", "C0003"), getVenc("HI7030L", "2028-01"), "Conductividad 12880 uS/cm"
            ],
            cond_potenciometrica: [
                "HI7031L", getLote("HI7031L", "C0001"), getVenc("HI7031L", "2028-01"), "Estándar Cond. Potenciométrica 1413 uS/cm",
                "HI7030L", getLote("HI7030L", "C0003"), getVenc("HI7030L", "2028-01"), "Estándar Cond. Potenciométrica 12880 uS/cm"
            ],
            oxigeno: [
                "HI7040L", getLote("HI7040L", "D0001"), getVenc("HI7040L", "2028-01"), "Cero Oxígeno Disuelto"
            ],
            ph_cond_us: [
                "HI7004L", getLote("HI7004L", "L0001"), getVenc("HI7004L", "2028-01"), "Buffer pH 4.01",
                "HI7007L", getLote("HI7007L", "L0002"), getVenc("HI7007L", "2028-01"), "Buffer pH 7.01",
                "HI7031L", getLote("HI7031L", "C0001"), getVenc("HI7031L", "2028-01"), "Conductividad 1413 uS/cm"
            ],
            ph_cond_ms: [
                "HI7004L", getLote("HI7004L", "L0001"), getVenc("HI7004L", "2028-01"), "Buffer pH 4.01",
                "HI7007L", getLote("HI7007L", "L0002"), getVenc("HI7007L", "2028-01"), "Buffer pH 7.01",
                "HI7030L", getLote("HI7030L", "C0003"), getVenc("HI7030L", "2028-01"), "Conductividad 12880 uS/cm"
            ],
            multiparametro: [
                "HI7004L", getLote("HI7004L", "L0001"), getVenc("HI7004L", "2028-01"), "Buffer pH 4.01",
                "HI7007L", getLote("HI7007L", "L0002"), getVenc("HI7007L", "2028-01"), "Buffer pH 7.01",
                "HI7010L", getLote("HI7010L", "L0003"), getVenc("HI7010L", "2028-01"), "Buffer pH 10.01",
                "HI7031L", getLote("HI7031L", "C0001"), getVenc("HI7031L", "2028-01"), "Conductividad 1413 uS/cm",
                "HI7030L", getLote("HI7030L", "C0003"), getVenc("HI7030L", "2028-01"), "Conductividad 12880 uS/cm",
                "HI7040L", getLote("HI7040L", "D0001"), getVenc("HI7040L", "2028-01"), "Cero Oxígeno Disuelto",
                "HI9828-1", getLote("HI9828-1", "M0001"), getVenc("HI9828-1", "2028-01"), "Calibración Rápida Quick Cal"
            ],
            fotometria: ["HI93701-01", getLote("HI93701-01", "F0001"), getVenc("HI93701-01", "2028-01"), "Reactivo Cloro Libre"],
            espectrofotometria: ["HI801-11", getLote("HI801-11", "E0001"), getVenc("HI801-11", "2028-01"), "Filtros Calibración Espectrofotómetro"],
            absorbancia: ["HI76404", getLote("HI76404", "A0001"), getVenc("HI76404", "2028-01"), "Patrón Absorbancia Calibración"],
            checkers: ["HI701-25", getLote("HI701-25", "K0001"), getVenc("HI701-25", "2028-01"), "Reactivo Checker Cloro Libre"],
            turbi_hi93703: [
                "HI93703-0", getLote("HI93703-0", "T0001"), getVenc("HI93703-0", "2028-01"), "Estándar 0 FTU",
                "HI93703-10", getLote("HI93703-10", "T0002"), getVenc("HI93703-10", "2028-01"), "Estándar 10 FTU",
                "HI93703-50", getLote("HI93703-50", "T0003"), getVenc("HI93703-50", "2028-01"), "Estándar 50 FTU"
            ],
            turbi_hi98703: [
                "HI98703-11", getLote("HI98703-11", "T0004"), getVenc("HI98703-11", "2028-01"), "Kit Estándares NTU"
            ]
        };
    }

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

    function llenarTablaMediciones(prefijoNombre, matrizDatos) {
        var inputs = document.querySelectorAll('input[name^="' + prefijoNombre + '"]');
        if (inputs.length === 0) {
            alert('No se encontraron campos para "' + prefijoNombre + '". Puede que el nombre real del campo en la página sea distinto — revísalo con Inspeccionar elemento y avísale a Brayan.');
            return;
        }
        var inicio = columnasPorFilaLecturas;
        for (var i = inicio; i < inputs.length; i++) {
            var idx = i - inicio;
            if (idx < matrizDatos.length) {
                inputs[i].value = matrizDatos[idx];
                inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
                inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }

    function borrarTablaMediciones(prefijoNombre) {
        var inputs = document.querySelectorAll('input[name^="' + prefijoNombre + '"]');
        for (var i = columnasPorFilaLecturas; i < inputs.length; i++) {
            inputs[i].value = '';
            inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
            inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function llenarLecturas(matrizDatos) { llenarTablaMediciones(PREFIJO_MEDICIONES_INICIALES, matrizDatos); }
    function borrarLecturas() { borrarTablaMediciones(PREFIJO_MEDICIONES_INICIALES); }
    function llenarMedicionesFinales(matrizDatos) { llenarTablaMediciones(PREFIJO_MEDICIONES_FINALES, matrizDatos); }
    function borrarMedicionesFinales() { borrarTablaMediciones(PREFIJO_MEDICIONES_FINALES); }

    function llenarSolucionesSecuencial(listaDatos) {
        var inputs = document.querySelectorAll('input[name^="' + PREFIJO_SOLUCIONES + '"], table input[name*="soluciones"]');
        if (inputs.length === 0) inputs = document.querySelectorAll('input[type="text"]');
        if (inputs.length === 0) return alert('No se encontraron campos de soluciones.');

        borrarSolucionesSecuencial();

        for (var i = 0; i < inputs.length; i++) {
            if (i < listaDatos.length) {
                inputs[i].value = listaDatos[i];
                inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
                inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }

    function borrarSolucionesSecuencial() {
        var inputs = document.querySelectorAll('input[name^="' + PREFIJO_SOLUCIONES + '"], table input[name*="soluciones"]');
        for (var i = 0; i < inputs.length; i++) {
            inputs[i].value = '';
            inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
            inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
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

    var opcionesLecturas = [
        { categoria: 'pH', items: [
            { clave: 'ph_temp_1dec', etiqueta: '🧪 pH / T° (1 Dec)' },
            { clave: 'ph_temp_2dec', etiqueta: '🧪 pH / T° (2 Dec)' },
            { clave: 'ph_mv_temp', etiqueta: '🧪 pH / mV / T°' }
        ]},
        { categoria: 'Conductividad', items: [
            { clave: 'cond_us', etiqueta: '⚡ Conductividad (µS/cm)' },
            { clave: 'cond_ms', etiqueta: '⚡ Conductividad (mS/cm)' },
            { clave: 'cond_potenciometrica', etiqueta: '⚡ Cond. Potenciométrica' }
        ]},
        { categoria: 'Oxígeno', items: [
            { clave: 'oxigeno', etiqueta: '💧 Oxígeno Disuelto' }
        ]},
        { categoria: 'Equipos combinados', items: [
            { clave: 'ph_cond_us_temp_1dec', etiqueta: '🔀 pH / Cond (µS) / T° (1 Dec)' },
            { clave: 'ph_cond_us_temp_2dec', etiqueta: '🔀 pH / Cond (µS) / T° (2 Dec)' },
            { clave: 'ph_cond_ms_temp_1dec', etiqueta: '🔀 pH / Cond (mS) / T° (1 Dec)' },
            { clave: 'ph_cond_ms_temp_2dec', etiqueta: '🔀 pH / Cond (mS) / T° (2 Dec)' },
            { clave: 'ph_oxigeno_temp', etiqueta: '🔀 pH / Oxígeno / T°' },
            { clave: 'multi_completo', etiqueta: '📊 Multiparámetro Completo' }
        ]},
        { categoria: 'Fotometría y óptica', items: [
            { clave: 'foto_cloro_ph', etiqueta: '💡 Fotometría (Cloro L, T, pH)' },
            { clave: 'foto_hi97xx_cloro', etiqueta: '💡 Fotometría HI97XX (Cloro Libre)' },
            { clave: 'espectrofotometria', etiqueta: '💡 Espectrofotometría' },
            { clave: 'absorbancia', etiqueta: '💡 Fotometría de Absorbancia' }
        ]},
        { categoria: 'Checkers', items: [
            { clave: 'checker_cloro_libre', etiqueta: '🟩 Checker Cloro Libre' },
            { clave: 'checker_cloro_total', etiqueta: '🟩 Checker Cloro Total' },
            { clave: 'checker_hierro', etiqueta: '🟩 Checker Hierro' },
            { clave: 'checker_color', etiqueta: '🟩 Checker Color de Agua' }
        ]},
        { categoria: 'Turbidez', items: [
            { clave: 'turbi_hi93703', etiqueta: '🌀 Turbidez HI 93703 (3 Patrones)' },
            { clave: 'turbi_hi98703', etiqueta: '🌀 Turbidez HI 98703' }
        ]},
        { categoria: 'Otros', items: [
            { clave: '__borrar__', etiqueta: '🗑️ Borrar esta tabla' }
        ]}
    ];

    var opcionesSoluciones = [
        { categoria: 'Individuales', items: [
            { clave: 'ph', etiqueta: '🧴 Soluciones pH' },
            { clave: 'cond_us', etiqueta: '🧴 Soluciones Cond (µS/cm)' },
            { clave: 'cond_ms', etiqueta: '🧴 Soluciones Cond (mS/cm)' },
            { clave: 'cond_potenciometrica', etiqueta: '🧴 Soluciones Cond. Potenciométrica' },
            { clave: 'oxigeno', etiqueta: '🧴 Soluciones Oxígeno' }
        ]},
        { categoria: 'Combinados', items: [
            { clave: 'ph_cond_us', etiqueta: '🔀 Soluciones pH + Cond (µS/cm)' },
            { clave: 'ph_cond_ms', etiqueta: '🔀 Soluciones pH + Cond (mS/cm)' },
            { clave: 'multiparametro', etiqueta: '📊 Soluciones Multiparámetro Completo' }
        ]},
        { categoria: 'Fotometría / ópticos', items: [
            { clave: 'fotometria', etiqueta: '🧴 Reactivos Fotometría' },
            { clave: 'espectrofotometria', etiqueta: '🧴 Reactivos Espectrofotometría' },
            { clave: 'absorbancia', etiqueta: '🧴 Patrones de Absorbancia' },
            { clave: 'checkers', etiqueta: '🧴 Reactivos Checkers' }
        ]},
        { categoria: 'Turbidez', items: [
            { clave: 'turbi_hi93703', etiqueta: '🌀 Soluciones Turbidez HI 93703' },
            { clave: 'turbi_hi98703', etiqueta: '🌀 Soluciones Turbidez HI 98703' }
        ]},
        { categoria: 'Otros', items: [
            { clave: '__borrar__', etiqueta: '🗑️ Borrar soluciones' }
        ]}
    ];

    function crearSelectorInline(opciones, colorBorde, placeholder, onSeleccionar) {
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
        select.style.border = '1px solid ' + colorBorde;
        select.style.color = '#495057';
        select.style.backgroundColor = '#fff';
        select.style.maxWidth = '360px';

        var optPlaceholder = document.createElement('option');
        optPlaceholder.textContent = placeholder;
        optPlaceholder.value = '';
        optPlaceholder.disabled = true;
        optPlaceholder.selected = true;
        select.appendChild(optPlaceholder);

        opciones.forEach(function(grupo) {
            var og = document.createElement('optgroup');
            og.label = grupo.categoria;
            grupo.items.forEach(function(item) {
                var op = document.createElement('option');
                op.textContent = item.etiqueta;
                op.value = item.clave;
                og.appendChild(op);
            });
            select.appendChild(og);
        });

        select.onchange = function() {
            var clave = select.value;
            select.value = ''; // vuelve al placeholder: es un "menú de un solo uso"
            if (clave) onSeleccionar(clave);
        };

        barra.appendChild(select);
        return barra;
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

    var controlesInyectados = { iniciales: false, finales: false, soluciones: false };

    function intentarInyectarControles() {
        if (!controlesInyectados.iniciales) {
            var refIni = document.querySelector('input[name^="' + PREFIJO_MEDICIONES_INICIALES + '"]');
            if (refIni) {
                var barraIni = crearSelectorInline(opcionesLecturas, '#17a2b8', '🧪 Autocompletar Mediciones Iniciales…', function(clave) {
                    if (clave === '__borrar__') borrarLecturas();
                    else llenarLecturas(lecturas[clave]);
                });
                if (anclarAntesDeTabla(refIni, barraIni)) controlesInyectados.iniciales = true;
            }
        }

        if (!controlesInyectados.finales) {
            var refFin = document.querySelector('input[name^="' + PREFIJO_MEDICIONES_FINALES + '"]');
            if (refFin) {
                var barraFin = crearSelectorInline(opcionesLecturas, '#17a2b8', '🧪 Autocompletar Mediciones Finales…', function(clave) {
                    if (clave === '__borrar__') borrarMedicionesFinales();
                    else llenarMedicionesFinales(lecturas[clave]);
                });
                if (anclarAntesDeTabla(refFin, barraFin)) controlesInyectados.finales = true;
            }
        }

        if (!controlesInyectados.soluciones) {
            var refSol = document.querySelector('input[name^="' + PREFIJO_SOLUCIONES + '"]');
            if (refSol) {
                var barraSol = crearSelectorInline(opcionesSoluciones, '#28a745', '🧴 Autocompletar Soluciones Estándar…', function(clave) {
                    if (clave === '__borrar__') borrarSolucionesSecuencial();
                    else llenarSolucionesSecuencial(obtenerSoluciones()[clave]);
                });
                var btnEditar = document.createElement('button');
                btnEditar.type = 'button';
                btnEditar.innerText = '✏️';
                btnEditar.title = 'Abrir el Google Sheet de lotes/vencimientos';
                btnEditar.style.padding = '4px 8px';
                btnEditar.style.fontSize = '12px';
                btnEditar.style.border = '1px solid #28a745';
                btnEditar.style.borderRadius = '4px';
                btnEditar.style.backgroundColor = '#fff';
                btnEditar.style.cursor = 'pointer';
                btnEditar.onclick = abrirEditorSheet;
                barraSol.appendChild(btnEditar);

                if (anclarAntesDeTabla(refSol, barraSol)) controlesInyectados.soluciones = true;
            }
        }

        if (controlesInyectados.iniciales && controlesInyectados.finales && controlesInyectados.soluciones && observadorDOM) {
            observadorDOM.disconnect();
        }
    }

    var observadorDOM = new MutationObserver(function() { intentarInyectarControles(); });
    observadorDOM.observe(document.body, { childList: true, subtree: true });

    // Aviso único en consola (5s tras cargar) para depurar campos que nunca aparecieron.
    setTimeout(function() {
        var faltantes = [];
        if (!controlesInyectados.iniciales) faltantes.push(PREFIJO_MEDICIONES_INICIALES);
        if (!controlesInyectados.finales) faltantes.push(PREFIJO_MEDICIONES_FINALES);
        if (!controlesInyectados.soluciones) faltantes.push(PREFIJO_SOLUCIONES);
        if (faltantes.length > 0) {
            console.warn('[Panel Hanna] No se encontraron todavía estos campos en la página (puede ser normal si el "Tipo de Informe" aún no se seleccionó): ' + faltantes.join(', '));
        }
    }, 5000);

    // ------------------------------------------
    // INSIGNIA DISCRETA: versión + sincronización de lotes + respaldo
    // ------------------------------------------
    var badge = document.createElement('div');
    badge.style.position = 'fixed';
    badge.style.bottom = '15px';
    badge.style.right = '15px';
    badge.style.zIndex = '99999';
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
    btnBadge.style.boxShadow = '0 2px 6px rgba(0,0,0,0.25)';

    var miniPanel = document.createElement('div');
    miniPanel.style.display = 'none';
    miniPanel.style.flexDirection = 'column';
    miniPanel.style.gap = '6px';
    miniPanel.style.marginBottom = '8px';
    miniPanel.style.backgroundColor = '#f8f9fa';
    miniPanel.style.padding = '10px';
    miniPanel.style.borderRadius = '8px';
    miniPanel.style.boxShadow = '0 6px 16px rgba(0,0,0,0.25)';
    miniPanel.style.border = '1px solid #dee2e6';
    miniPanel.style.width = '260px';
    miniPanel.style.fontSize = '11px';

    var etiquetaSheetSync = document.createElement('div');
    etiquetaSheetSync.style.color = '#6c757d';
    miniPanel.appendChild(etiquetaSheetSync);

    function actualizarEtiquetaSheetSync() {
        if (sheetUltimaActualizacion) {
            etiquetaSheetSync.innerText = '🔄 Lotes sincronizados: ' + sheetUltimaActualizacion.toLocaleString();
        } else {
            etiquetaSheetSync.innerText = '⚠️ Sin datos del Sheet todavía (usando valores por defecto).';
        }
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

    miniPanel.appendChild(crearBtnMini('🔄 Recargar lotes del Sheet', '#6c757d', function() {
        cargarDatosSheet(function(ok) {
            actualizarEtiquetaSheetSync();
            alert(ok ? 'Lotes actualizados desde el Sheet.' : 'No se pudo conectar al Sheet. Se mantienen los últimos datos conocidos.');
        });
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

    badge.appendChild(miniPanel);
    badge.appendChild(btnBadge);
    document.body.appendChild(badge);

    // Carga inicial de lotes: primero lo que quedó en caché (instantáneo),
    // luego intenta refrescar desde el Sheet en segundo plano.
    cargarCache();
    actualizarEtiquetaSheetSync();
    cargarDatosSheet(actualizarEtiquetaSheetSync);

    // Primer intento de inyección (por si las tablas ya están en el DOM al cargar).
    intentarInyectarControles();

})();