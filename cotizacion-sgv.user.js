// ==UserScript==
// @name         Autocompletar Cotización SGV - Hanna Colombia
// @namespace    https://intranet.hannacolombia.com/
// @version      1.0.0
// @description  En "Crear Cotización" (SGV): llena "Fecha Primer Seguimiento" (hoy + 2 días hábiles), "Fecha Cierre" (hoy + 2 meses, ajustada a día hábil si cae fin de semana), el comentario "Cotización relacionada a la OTST ..." si el campo OTST tiene un valor, y los campos de "Información de Aplicación" con un texto por defecto. Solo llena campos VACÍOS, nunca pisa lo que ya hayas escrito.
// @author       Servicio Técnico Hanna Colombia
// @match        https://intranet.hannacolombia.com/sgv/ingresos/cotizaciones/crear*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/cotizacion-sgv.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/cotizacion-sgv.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Texto fijo para los campos de "Información de Aplicación" cuando no
  // hay esa información a mano.
  const TEXTO_SIN_INFO = 'No contamos con esa información';

  function dispararEventos(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ─────────────────────────────────────────────
  // 1. FECHAS: solo días hábiles (lunes a viernes)
  // ─────────────────────────────────────────────
  function esFinDeSemana(fecha) {
    const dia = fecha.getDay(); // 0 = domingo, 6 = sábado
    return dia === 0 || dia === 6;
  }

  // Suma "n" DÍAS HÁBILES a una fecha (salta sábados y domingos). Ej.: si
  // hoy es viernes, +2 días hábiles cae el martes siguiente (se saltan
  // sábado y domingo).
  function sumarDiasHabiles(fechaBase, diasHabiles) {
    const resultado = new Date(fechaBase.getTime());
    let sumados = 0;
    while (sumados < diasHabiles) {
      resultado.setDate(resultado.getDate() + 1);
      if (!esFinDeSemana(resultado)) sumados++;
    }
    return resultado;
  }

  // Suma meses de calendario (no días hábiles) — "2 meses" es una
  // duración, no una cuenta de días laborales.
  function sumarMeses(fechaBase, meses) {
    const resultado = new Date(fechaBase.getTime());
    resultado.setMonth(resultado.getMonth() + meses);
    return resultado;
  }

  // Si una fecha cae sábado o domingo, la mueve al siguiente lunes. Se usa
  // en "Fecha Cierre": al sumar meses de calendario, el resultado puede
  // caer cualquier día de la semana, y el pedido es trabajar solo con
  // días hábiles.
  function ajustarASiguienteDiaHabil(fecha) {
    const resultado = new Date(fecha.getTime());
    while (esFinDeSemana(resultado)) {
      resultado.setDate(resultado.getDate() + 1);
    }
    return resultado;
  }

  // El sitio muestra las fechas como "05/10/2026" (DD/MM/AAAA, ver el
  // texto de ayuda "Format: ..." debajo de cada campo de fecha).
  function formatearFecha(fecha) {
    const dd = String(fecha.getDate()).padStart(2, '0');
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const yyyy = fecha.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  // ─────────────────────────────────────────────
  // 2. LLENAR UN CAMPO SOLO SI ESTÁ VACÍO
  // Nunca pisa algo que el técnico ya haya escrito o corregido a mano.
  // ─────────────────────────────────────────────
  function llenarSiVacio(campo, valor) {
    if (!campo) return false;
    if (campo.value && campo.value.trim() !== '') return false;
    campo.value = valor;
    dispararEventos(campo);
    return true;
  }

  // ─────────────────────────────────────────────
  // 3. "INFORMACIÓN DE APLICACIÓN": ubicar sus campos SIN depender de sus
  // nombres/id exactos (no se pudieron confirmar por inspección). Se
  // buscan los <input type="text"> que caen, en el orden del documento,
  // entre el encabezado "Información de Aplicación" y el siguiente
  // encabezado ("Forma de Pago") — mismo criterio de "buscar por texto
  // visible" que ya usan otros scripts de este repo (ej. "Contacto" o
  // "URI Externa" en whatsapp-ot.user.js) para no depender del HTML
  // interno exacto, que puede cambiar.
  // ─────────────────────────────────────────────
  function buscarEncabezado(texto) {
    const candidatos = document.querySelectorAll('div, h2, h3, h4, legend, span');
    for (const el of candidatos) {
      if (el.children.length > 2) continue; // debe ser un encabezado simple, no un contenedor grande
      if ((el.textContent || '').trim().toLowerCase() === texto.toLowerCase()) return el;
    }
    return null;
  }

  function obtenerCamposEntreEncabezados(inicioTexto, finTexto) {
    const inicio = buscarEncabezado(inicioTexto);
    if (!inicio) return [];
    const fin = finTexto ? buscarEncabezado(finTexto) : null;

    const inputs = document.querySelectorAll('input[type="text"]');
    const resultado = [];
    inputs.forEach((inp) => {
      const posInicio = inicio.compareDocumentPosition(inp);
      if (!(posInicio & Node.DOCUMENT_POSITION_FOLLOWING)) return; // no está después del encabezado de inicio
      if (fin) {
        const posFin = fin.compareDocumentPosition(inp);
        if (!(posFin & Node.DOCUMENT_POSITION_PRECEDING)) return; // ya pasó el siguiente encabezado
      }
      resultado.push(inp);
    });
    return resultado;
  }

  // ─────────────────────────────────────────────
  // 4. COMENTARIO DE LA OTST RELACIONADA
  // Si el campo "Nº de OT de Servicio Técnico (OTST)" tiene algo escrito,
  // agrega "Cotización relacionada a la OTST ..." en Comentarios. Si está
  // vacío, Comentarios se deja tal cual (vacío). Como el técnico puede
  // escribir el OTST DESPUÉS de que cargue la página, esto se reevalúa
  // cada vez que ese campo cambia, no solo una vez al inicio.
  // ─────────────────────────────────────────────
  function actualizarComentarioOtst(campoOtst, campoComentarios) {
    const otst = campoOtst.value.trim();
    if (!otst) return; // vacío: no se toca Comentarios
    if (campoComentarios.dataset.hannaAutoComentario) return; // ya se completó una vez automáticamente
    if (!llenarSiVacio(campoComentarios, `Cotización relacionada a la OTST ${otst}`)) return; // ya tenía texto propio
    campoComentarios.dataset.hannaAutoComentario = '1';
  }

  // ─────────────────────────────────────────────
  // 5. ARRANQUE
  // ─────────────────────────────────────────────
  function procesar() {
    const hoy = new Date();

    // Fecha Primer Seguimiento = hoy + 2 días hábiles
    const campoSeguimiento = document.querySelector('input[name="fecha_seguimiento[date]"]');
    if (campoSeguimiento && !campoSeguimiento.dataset.hannaAuto) {
      campoSeguimiento.dataset.hannaAuto = '1';
      llenarSiVacio(campoSeguimiento, formatearFecha(sumarDiasHabiles(hoy, 2)));
    }

    // Fecha Cierre = hoy + 2 meses, ajustada a día hábil si cae fin de semana
    const campoCierre = document.querySelector('input[name="fecha_cierre[date]"]');
    if (campoCierre && !campoCierre.dataset.hannaAuto) {
      campoCierre.dataset.hannaAuto = '1';
      const fechaCierre = ajustarASiguienteDiaHabil(sumarMeses(hoy, 2));
      llenarSiVacio(campoCierre, formatearFecha(fechaCierre));
    }

    // Comentarios: según el valor actual del campo OTST, y se vuelve a
    // revisar si el técnico lo llena más tarde (ver listener más abajo).
    const campoOtst = document.getElementById('edit-stot-id') || document.querySelector('input[name="stot_id"]');
    const campoComentarios = document.getElementById('cotizacion_comentarios') || document.querySelector('textarea[name="cotizacion_comentarios"]');
    if (campoOtst && campoComentarios) {
      actualizarComentarioOtst(campoOtst, campoComentarios);
      if (!campoOtst.dataset.hannaListener) {
        campoOtst.dataset.hannaListener = '1';
        campoOtst.addEventListener('input', () => actualizarComentarioOtst(campoOtst, campoComentarios));
        campoOtst.addEventListener('blur', () => actualizarComentarioOtst(campoOtst, campoComentarios));
      }
    }

    // Información de Aplicación: todos los campos de texto de esa
    // sección, si están vacíos.
    const camposAplicacion = obtenerCamposEntreEncabezados('Información de Aplicación', 'Forma de Pago');
    camposAplicacion.forEach((campo) => {
      if (!campo.dataset.hannaAuto) {
        campo.dataset.hannaAuto = '1';
        llenarSiVacio(campo, TEXTO_SIN_INFO);
      }
    });
  }

  function init() {
    procesar();
    // El formulario puede ir revelando secciones de forma dinámica (al
    // elegir contacto, tipo de cotización, etc.), así que se reintenta
    // con cada cambio del DOM. Cada campo solo se llena UNA vez (ver los
    // "dataset.hannaAuto" de arriba), así que reintentar nunca pisa algo
    // que el técnico ya haya escrito o corregido a mano.
    const observer = new MutationObserver(() => procesar());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
