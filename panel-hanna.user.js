// ==UserScript==
// @name         Panel de Control Intranet Hanna
// @namespace    http://tampermonkey.net/
// @version      13.0
// @description  Panel completo con mediciones, patrones de T° y 3 estándares para turbidez HI93703
// @author       Brayan Galeano
// @match        https://intranet.hannacolombia.com/stecnico/item/*/diagnosis
// @grant        none
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/panel-hanna.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/main/panel-hanna.user.js
// ==/UserScript==

(function() {
    'use strict';

    var columnasPorFilaLecturas = 3;

    // ==========================================
    // 0. SISTEMA DE GESTIÓN DE LOTES INDIVIDUALES (LOCALSTORAGE)
    // ==========================================

    function getLote(codigo, defecto) {
        return localStorage.getItem('hanna_lote_' + codigo) || defecto;
    }

    function getVenc(codigo, defecto) {
        return localStorage.getItem('hanna_venc_' + codigo) || defecto;
    }

    function actualizarLotesGrupo(nombreGrupo, items) {
        alert("Configuración de lotes para: " + nombreGrupo);
        var cambios = false;

        items.forEach(function(item) {
            var actualLote = getLote(item.cod, item.loteDef);
            var actualVenc = getVenc(item.cod, item.vencDef);

            var nuevoLote = prompt("[" + item.cod + "] " + item.nom + "\nIngresa el LOTE actual:", actualLote);
            if (nuevoLote !== null && nuevoLote.trim() !== "") {
                localStorage.setItem('hanna_lote_' + item.cod, nuevoLote.trim());
                cambios = true;
            }

            var nuevoVenc = prompt("[" + item.cod + "] " + item.nom + "\nIngresa la FECHA DE EXPIRACIÓN (AAAA-MM):", actualVenc);
            if (nuevoVenc !== null && nuevoVenc.trim() !== "") {
                localStorage.setItem('hanna_venc_' + item.cod, nuevoVenc.trim());
                cambios = true;
            }
        });

        if (cambios) {
            alert("¡Lotes y fechas de " + nombreGrupo + " actualizados con éxito!");
            location.reload();
        }
    }

    // Listas de configuración para actualización por prompt
    var configpH = [
        { cod: 'HI7004L', nom: 'Buffer pH 4.01', loteDef: '2459', vencDef: '11/2030' },
        { cod: 'HI7007L', nom: 'Buffer pH 7.01', loteDef: '2804', vencDef: '01/2031' },
        { cod: 'HI7010L', nom: 'Buffer pH 10.01', loteDef: '3231', vencDef: '04/2028' }
    ];

    var configCond = [
        { cod: 'HI7031L', nom: 'Conductividad 1413 uS/cm', loteDef: '2521', vencDef: '11/2030' },
        { cod: 'HI7033L', nom: 'Conductividad 84 uS/cm', loteDef: '3448', vencDef: '05/2029' },
        { cod: 'HI7030L', nom: 'Conductividad 12880 uS/cm', loteDef: '1637', vencDef: '05/2030' }
    ];

    var configDO = [
        { cod: 'HI7040L', nom: 'Cero Oxígeno Disuelto', loteDef: 'S0089-24', vencDef: '09/2029' }
    ];

    var configTurbi93 = [
        { cod: 'HI93703-0', nom: 'Estándar Turbidez 0 FTU', loteDef: 'T0001', vencDef: '2028-01' },
        { cod: 'HI93703-10', nom: 'Estándar Turbidez 10 FTU', loteDef: 'T0002', vencDef: '2028-01' },
        { cod: 'HI93703-50', nom: 'Estándar Turbidez 50 FTU', loteDef: 'T0003', vencDef: '2028-01' }
    ];

    var configTurbi98 = [
        { cod: 'HI98703-11', nom: 'Kit Estándares NTU', loteDef: 'T0004', vencDef: '2028-01' }
    ];

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

    function llenarLecturas(matrizDatos) {
        var inputs = document.querySelectorAll('input[name^="mediciones_iniciales"]');
        if (inputs.length === 0) return alert('No se encontraron campos de mediciones.');

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

    function borrarLecturas() {
        var inputs = document.querySelectorAll('input[name^="mediciones_iniciales"]');
        for (var i = columnasPorFilaLecturas; i < inputs.length; i++) {
            inputs[i].value = '';
            inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
            inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function llenarSolucionesSecuencial(listaDatos) {
        var inputs = document.querySelectorAll('input[name^="soluciones_codigo"], table input[name*="soluciones"]');
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
        var inputs = document.querySelectorAll('input[name^="soluciones_codigo"], table input[name*="soluciones"]');
        for (var i = 0; i < inputs.length; i++) {
            inputs[i].value = '';
            inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
            inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    // ==========================================
    // 3. INTERFAZ GRÁFICA ORGANIZADA
    // ==========================================

    var contenedor = document.createElement('div');
    contenedor.style.position = 'fixed';
    contenedor.style.bottom = '15px';
    contenedor.style.right = '15px';
    contenedor.style.zIndex = '99999';
    contenedor.style.fontFamily = 'Arial, sans-serif';

    var btnPrincipal = document.createElement('button');
    btnPrincipal.innerText = '⚙️ Panel Hanna ▴';
    btnPrincipal.type = 'button';
    btnPrincipal.style.padding = '10px 16px';
    btnPrincipal.style.backgroundColor = '#0056b3';
    btnPrincipal.style.color = '#fff';
    btnPrincipal.style.border = 'none';
    btnPrincipal.style.borderRadius = '6px';
    btnPrincipal.style.cursor = 'pointer';
    btnPrincipal.style.fontWeight = 'bold';
    btnPrincipal.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';

    var panel = document.createElement('div');
    panel.style.display = 'none';
    panel.style.flexDirection = 'column';
    panel.style.gap = '6px';
    panel.style.marginBottom = '10px';
    panel.style.backgroundColor = '#f8f9fa';
    panel.style.padding = '12px';
    panel.style.borderRadius = '8px';
    panel.style.boxShadow = '0 6px 16px rgba(0,0,0,0.25)';
    panel.style.border = '1px solid #dee2e6';
    panel.style.width = '310px';
    panel.style.maxHeight = '80vh';
    panel.style.overflowY = 'auto';

    function crearTitulo(texto) {
        var h = document.createElement('div');
        h.innerText = texto;
        h.style.fontWeight = 'bold';
        h.style.fontSize = '11px';
        h.style.color = '#0056b3';
        h.style.textTransform = 'uppercase';
        h.style.borderBottom = '1px solid #0056b3';
        h.style.paddingBottom = '2px';
        h.style.marginTop = '8px';
        return h;
    }

    function crearSubtitulo(texto) {
        var h = document.createElement('div');
        h.innerText = texto;
        h.style.fontWeight = 'bold';
        h.style.fontSize = '10px';
        h.style.color = '#6c757d';
        h.style.marginTop = '4px';
        return h;
    }

    function crearFilaConfig(textoBtn, colorBtn, accionLlenar, accionConfig) {
        var div = document.createElement('div');
        div.style.display = 'flex';
        div.style.gap = '4px';

        var bMain = document.createElement('button');
        bMain.innerText = textoBtn;
        bMain.type = 'button';
        bMain.style.flex = '1';
        bMain.style.padding = '5px 8px';
        bMain.style.backgroundColor = colorBtn;
        bMain.style.color = '#fff';
        bMain.style.border = 'none';
        bMain.style.borderRadius = '4px';
        bMain.style.cursor = 'pointer';
        bMain.style.fontSize = '11px';
        bMain.style.textAlign = 'left';
        bMain.onclick = accionLlenar;

        div.appendChild(bMain);

        if (accionConfig) {
            var bCfg = document.createElement('button');
            bCfg.innerText = '⚙️';
            bCfg.type = 'button';
            bCfg.title = 'Editar Lotes/Fechas de este grupo';
            bCfg.style.padding = '5px 8px';
            bCfg.style.backgroundColor = '#6c757d';
            bCfg.style.color = '#fff';
            bCfg.style.border = 'none';
            bCfg.style.borderRadius = '4px';
            bCfg.style.cursor = 'pointer';
            bCfg.style.fontSize = '11px';
            bCfg.onclick = accionConfig;
            div.appendChild(bCfg);
        }

        return div;
    }

    function crearBtn(texto, color, accion) {
        var b = document.createElement('button');
        b.innerText = texto;
        b.type = 'button';
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

    // ------------------------------------------
    // SECCIÓN 1. MEDICIONES / LECTURAS
    // ------------------------------------------
    panel.appendChild(crearTitulo('1. Lecturas Iniciales'));

    panel.appendChild(crearSubtitulo('── Parámetro: pH ──'));
    panel.appendChild(crearBtn('🧪 pH / T° (1 Dec)', '#17a2b8', function() { llenarLecturas(lecturas.ph_temp_1dec); }));
    panel.appendChild(crearBtn('🧪 pH / T° (2 Dec)', '#17a2b8', function() { llenarLecturas(lecturas.ph_temp_2dec); }));
    panel.appendChild(crearBtn('🧪 pH / mV / T°', '#17a2b8', function() { llenarLecturas(lecturas.ph_mv_temp); }));

    panel.appendChild(crearSubtitulo('── Parámetro: Conductividad ──'));
    panel.appendChild(crearBtn('⚡ Conductividad (µS/cm)', '#17a2b8', function() { llenarLecturas(lecturas.cond_us); }));
    panel.appendChild(crearBtn('⚡ Conductividad (mS/cm)', '#17a2b8', function() { llenarLecturas(lecturas.cond_ms); }));
    panel.appendChild(crearBtn('⚡ Cond. Potenciométrica', '#17a2b8', function() { llenarLecturas(lecturas.cond_potenciometrica); }));

    panel.appendChild(crearSubtitulo('── Parámetro: Oxígeno ──'));
    panel.appendChild(crearBtn('💧 Oxígeno Disuelto', '#17a2b8', function() { llenarLecturas(lecturas.oxigeno); }));

    panel.appendChild(crearSubtitulo('── Equipos Combinados ──'));
    panel.appendChild(crearBtn('🔀 pH / Cond (µS) / T° (1 Dec)', '#17a2b8', function() { llenarLecturas(lecturas.ph_cond_us_temp_1dec); }));
    panel.appendChild(crearBtn('🔀 pH / Cond (µS) / T° (2 Dec)', '#17a2b8', function() { llenarLecturas(lecturas.ph_cond_us_temp_2dec); }));
    panel.appendChild(crearBtn('🔀 pH / Cond (mS) / T° (1 Dec)', '#17a2b8', function() { llenarLecturas(lecturas.ph_cond_ms_temp_1dec); }));
    panel.appendChild(crearBtn('🔀 pH / Cond (mS) / T° (2 Dec)', '#17a2b8', function() { llenarLecturas(lecturas.ph_cond_ms_temp_2dec); }));
    panel.appendChild(crearBtn('🔀 pH / Oxígeno / T°', '#17a2b8', function() { llenarLecturas(lecturas.ph_oxigeno_temp); }));
    panel.appendChild(crearBtn('📊 Multiparámetro Completo', '#17a2b8', function() { llenarLecturas(lecturas.multi_completo); }));

    panel.appendChild(crearSubtitulo('── Fotometría y Óptica ──'));
    panel.appendChild(crearBtn('💡 Fotometría (Cloro L, T, pH)', '#17a2b8', function() { llenarLecturas(lecturas.foto_cloro_ph); }));
    panel.appendChild(crearBtn('💡 Fotometría HI97XX (Cloro Libre)', '#17a2b8', function() { llenarLecturas(lecturas.foto_hi97xx_cloro); }));
    panel.appendChild(crearBtn('💡 Espectrofotometría', '#17a2b8', function() { llenarLecturas(lecturas.espectrofotometria); }));
    panel.appendChild(crearBtn('💡 Fotometría de Absorbancia', '#17a2b8', function() { llenarLecturas(lecturas.absorbancia); }));

    panel.appendChild(crearSubtitulo('── Checkers ──'));
    panel.appendChild(crearBtn('🟩 Checker Cloro Libre', '#17a2b8', function() { llenarLecturas(lecturas.checker_cloro_libre); }));
    panel.appendChild(crearBtn('🟩 Checker Cloro Total', '#17a2b8', function() { llenarLecturas(lecturas.checker_cloro_total); }));
    panel.appendChild(crearBtn('🟩 Checker Hierro', '#17a2b8', function() { llenarLecturas(lecturas.checker_hierro); }));
    panel.appendChild(crearBtn('🟩 Checker Color de Agua', '#17a2b8', function() { llenarLecturas(lecturas.checker_color); }));

    panel.appendChild(crearSubtitulo('── Turbidez ──'));
    panel.appendChild(crearBtn('🌀 Turbidez HI 93703 (3 Patrones)', '#17a2b8', function() { llenarLecturas(lecturas.turbi_hi93703); }));
    panel.appendChild(crearBtn('🌀 Turbidez HI 98703', '#17a2b8', function() { llenarLecturas(lecturas.turbi_hi98703); }));

    panel.appendChild(crearBtn('🗑️ Borrar Lecturas', '#dc3545', borrarLecturas));

    // ------------------------------------------
    // SECCIÓN 2. SOLUCIONES ESTÁNDAR
    // ------------------------------------------
    panel.appendChild(crearTitulo('2. Soluciones Estándar'));

    panel.appendChild(crearFilaConfig('🧴 Soluciones pH', '#28a745',
        function() { llenarSolucionesSecuencial(obtenerSoluciones().ph); },
        function() { actualizarLotesGrupo('pH', configpH); }
    ));

    panel.appendChild(crearFilaConfig('🧴 Soluciones Cond (µS/cm)', '#28a745',
        function() { llenarSolucionesSecuencial(obtenerSoluciones().cond_us); },
        function() { actualizarLotesGrupo('Conductividad', configCond); }
    ));

    panel.appendChild(crearFilaConfig('🧴 Soluciones Cond (mS/cm)', '#28a745',
        function() { llenarSolucionesSecuencial(obtenerSoluciones().cond_ms); },
        function() { actualizarLotesGrupo('Conductividad', configCond); }
    ));

    panel.appendChild(crearFilaConfig('🧴 Soluciones Cond. Potenciométrica', '#28a745',
        function() { llenarSolucionesSecuencial(obtenerSoluciones().cond_potenciometrica); },
        function() { actualizarLotesGrupo('Conductividad Potenciométrica', configCond); }
    ));

    panel.appendChild(crearFilaConfig('🧴 Soluciones Oxígeno', '#28a745',
        function() { llenarSolucionesSecuencial(obtenerSoluciones().oxigeno); },
        function() { actualizarLotesGrupo('Oxígeno Disuelto', configDO); }
    ));

    panel.appendChild(crearBtn('🔀 Soluciones pH + Cond (µS/cm)', '#28a745', function() { llenarSolucionesSecuencial(obtenerSoluciones().ph_cond_us); }));
    panel.appendChild(crearBtn('🔀 Soluciones pH + Cond (mS/cm)', '#28a745', function() { llenarSolucionesSecuencial(obtenerSoluciones().ph_cond_ms); }));
    panel.appendChild(crearBtn('📊 Soluciones Multiparámetro Completo', '#28a745', function() { llenarSolucionesSecuencial(obtenerSoluciones().multiparametro); }));

    panel.appendChild(crearBtn('🧴 Reactivos Fotometría', '#28a745', function() { llenarSolucionesSecuencial(obtenerSoluciones().fotometria); }));
    panel.appendChild(crearBtn('🧴 Reactivos Espectrofotometría', '#28a745', function() { llenarSolucionesSecuencial(obtenerSoluciones().espectrofotometria); }));
    panel.appendChild(crearBtn('🧴 Patrones de Absorbancia', '#28a745', function() { llenarSolucionesSecuencial(obtenerSoluciones().absorbancia); }));
    panel.appendChild(crearBtn('🧴 Reactivos Checkers', '#28a745', function() { llenarSolucionesSecuencial(obtenerSoluciones().checkers); }));

    panel.appendChild(crearFilaConfig('🌀 Soluciones Turbidez HI 93703', '#28a745',
        function() { llenarSolucionesSecuencial(obtenerSoluciones().turbi_hi93703); },
        function() { actualizarLotesGrupo('Turbidez HI 93703', configTurbi93); }
    ));

    panel.appendChild(crearFilaConfig('🌀 Soluciones Turbidez HI 98703', '#28a745',
        function() { llenarSolucionesSecuencial(obtenerSoluciones().turbi_hi98703); },
        function() { actualizarLotesGrupo('Turbidez HI 98703', configTurbi98); }
    ));

    panel.appendChild(crearBtn('🗑️ Borrar Soluciones', '#dc3545', borrarSolucionesSecuencial));

    btnPrincipal.onclick = function() {
        panel.style.display = (panel.style.display === 'none') ? 'flex' : 'none';
    };

    contenedor.appendChild(panel);
    contenedor.appendChild(btnPrincipal);
    document.body.appendChild(contenedor);

})();
