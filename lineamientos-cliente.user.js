// ==UserScript==
// @name         Lineamientos del Cliente - Hanna Colombia
// @namespace    https://intranet.hannacolombia.com/
// @version      1.2.0
// @description  Muestra los lineamientos especiales del cliente (por NIT), leídos de Google Sheets, debajo de la tarjeta de Estado; y renombra un par de etiquetas de la tabla de detalle. Todo en "Ver Detalle" de la OT.
// @author       Servicio Técnico Hanna Colombia
// @match        https://intranet.hannacolombia.com/stecnico/item/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/lineamientos-cliente.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/lineamientos-cliente.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Debe coincidir siempre con @version del header de arriba.
  const APP_VERSION = '1.2.0';

  // ─────────────────────────────────────────────
  // CONFIGURACIÓN
  // ─────────────────────────────────────────────
  const LINEAMIENTOS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT2t_Y1keodEQiK9Iv4C8PoYmkAe-dFDgVek2z4fAr9IACCV-XDzFvB8jnrBB6J5t4uUwgpwn2W9CSz/pub?gid=256491155&single=true&output=csv';
  const CACHE_KEY = 'hanna_lineamientos_cache_v1';

  // Orden fijo en el que se muestran las categorías conocidas, sin importar
  // el orden de las filas en el Sheet. Cualquier categoría que alguien
  // escriba en el Sheet y NO esté en esta lista igual se muestra (para no
  // perder datos por una categoría nueva o mal escrita) — se agrega al
  // final, en el orden en que aparece por primera vez en el Sheet.
  const ORDEN_CATEGORIAS = [
    'Ingreso en Intranet',
    'Diagnóstico',
    'Equipos Operativos',
    'Equipos No Operativos',
    'Facturación y Despacho',
    'Comunicación con el Cliente',
  ];

  // ─────────────────────────────────────────────
  // Esta URL sirve tanto "Ver Detalle" (/stecnico/item/12345) como sus
  // pestañas (Diagnóstico, Comentarios App Externa, etc., que agregan uno o
  // más segmentos a la ruta). Este script SOLO debe correr en "Ver Detalle".
  // ─────────────────────────────────────────────
  const segmentos = window.location.pathname.split('/').filter(Boolean);
  if (segmentos.length !== 3 || segmentos[0] !== 'stecnico' || segmentos[1] !== 'item') {
    return;
  }

  // A veces la intranet carga/muestra el NIT con un sufijo extra que NO
  // corresponde al NIT base del cliente en el Sheet, ej. "860000198.1" o
  // "860000198-6" en vez de "860000198". Para que igual haga match, se corta
  // todo lo que venga después del primer "." o "-" ANTES de limpiar el resto
  // de caracteres no numéricos (así, un NIT normal como "900.947.820" sigue
  // limpiándose bien, porque ahí el "." es solo separador de miles y no un
  // sufijo real).
  function normalizarNit(texto) {
    const t = (texto || '').trim();
    const corteGuion = t.split('-')[0];
    const partesPunto = corteGuion.split('.');
    // Si el primer bloque después de un punto tiene 1 o 2 dígitos, se asume
    // que es un sufijo (ej. "860000198.1") y no un separador de miles (ej.
    // "900.947.820", donde cada bloque salvo el primero tiene 3 dígitos).
    let base = corteGuion;
    if (partesPunto.length > 1 && /^\d{1,2}$/.test(partesPunto[partesPunto.length - 1])) {
      base = partesPunto.slice(0, -1).join('.');
    }
    return base.replace(/[^\d]/g, '');
  }

  // ─────────────────────────────────────────────
  // Renombra etiquetas de la tabla "Ver Detalle" (las celdas <td class="key">
  // con el nombre del campo, ej. "Fecha creación", "Cliente"...). Es
  // independiente de los lineamientos: corre siempre, tenga o no el cliente
  // algo registrado en el Sheet.
  // ─────────────────────────────────────────────
  const RENOMBRES_ETIQUETAS = {
    'E-mails del cliente para copia de notificaciones': 'E-mails de Copia',
    'Última Atención Aplicaciones Cliente': 'Ultima visita IA',
  };

  function renombrarEtiquetas() {
    document.querySelectorAll('td.key').forEach((celda) => {
      const actual = (celda.textContent || '').trim();
      const nuevo = RENOMBRES_ETIQUETAS[actual];
      if (nuevo) celda.textContent = nuevo;
    });
  }

  // ─────────────────────────────────────────────
  // Extracción del NIT/nombre del cliente de la página. Mismo patrón ya
  // probado en qr-ordenes-trabajo.user.js: busca un elemento chico (pocos
  // hijos, poco texto) que contenga "NIT", en vez de depender de un id/clase
  // fijo que la intranet podría no tener o cambiar.
  //   Cliente    FRUDELPA FRUTOS DEL PACIFICO S.A.S
  //              NIT: 900947820
  //              Nº Manager: 78967
  // ─────────────────────────────────────────────
  function getClienteEmpresa() {
    const result = { nombre: null, nit: null };
    try {
      for (const el of document.querySelectorAll('*')) {
        if (el.children.length > 6) continue;
        const text = el.textContent || '';
        if (text.length > 400 || !/\bNIT\b/i.test(text)) continue;

        const nitMatch = text.match(/NIT:?\s*([\d.\-]{5,20})/i);
        if (!nitMatch) continue;

        const cleaned = text.replace(/\s+/g, ' ').trim();
        const nombreMatch = cleaned.match(/cliente\s+([A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑ0-9A-Za-záéíóúüñ.,&\s-]{3,80}?)\s+NIT/i);

        result.nit = normalizarNit(nitMatch[1]);
        if (nombreMatch) result.nombre = nombreMatch[1].trim();
        break;
      }
    } catch (e) {
      console.warn('[Lineamientos Cliente] No se pudo extraer el NIT del cliente:', e);
    }
    return result;
  }

  // ─────────────────────────────────────────────
  // Parser de CSV simple (soporta comillas y comas dentro de campos).
  // ─────────────────────────────────────────────
  function parseCSV(texto) {
    const filas = [];
    let fila = [];
    let campo = '';
    let dentroComillas = false;
    const t = texto.replace(/\r\n/g, '\n');
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (dentroComillas) {
        if (c === '"') {
          if (t[i + 1] === '"') { campo += '"'; i++; }
          else dentroComillas = false;
        } else {
          campo += c;
        }
      } else if (c === '"') {
        dentroComillas = true;
      } else if (c === ',') {
        fila.push(campo);
        campo = '';
      } else if (c === '\n') {
        fila.push(campo);
        filas.push(fila);
        fila = [];
        campo = '';
      } else {
        campo += c;
      }
    }
    if (campo !== '' || fila.length > 0) {
      fila.push(campo);
      filas.push(fila);
    }
    return filas;
  }

  // Agrupa las filas del Sheet que correspondan al NIT buscado, por
  // categoría. En el Sheet, el NIT/Razón Social solo se escribe en la
  // primera fila de cada cliente (las filas siguientes de sus lineamientos
  // los dejan en blanco) — se interpreta como "mismo cliente que la fila de
  // arriba" mientras esas columnas sigan vacías.
  function agruparLineamientos(filas, nitBuscado) {
    if (!filas || filas.length < 2) return null;

    const encabezados = (filas[0] || []).map((h) => h.trim().toLowerCase());
    const idxNit = encabezados.indexOf('nit');
    const idxRazon = encabezados.indexOf('razon social');
    const idxCategoria = encabezados.indexOf('categoria');
    const idxLineamiento = encabezados.indexOf('lineamiento');
    if (idxNit === -1 || idxCategoria === -1 || idxLineamiento === -1) {
      console.warn('[Lineamientos Cliente] No se encontraron las columnas esperadas (NIT/Categoria/Lineamiento) en el Sheet.');
      return null;
    }

    const porCategoria = {};
    const ordenEncontrado = [];
    let razonSocial = '';
    let nitActual = '';
    let razonActual = '';

    for (let i = 1; i < filas.length; i++) {
      const f = filas[i];
      if (!f || f.length === 0) continue;

      const nitFila = (f[idxNit] || '').trim();
      const razonFila = idxRazon > -1 ? (f[idxRazon] || '').trim() : '';
      if (nitFila) {
        nitActual = normalizarNit(nitFila);
        razonActual = razonFila;
      }
      if (!nitActual || nitActual !== nitBuscado) continue;

      const categoria = (f[idxCategoria] || '').trim();
      const lineamiento = (f[idxLineamiento] || '').trim();
      if (!categoria || !lineamiento) continue;

      if (!porCategoria[categoria]) {
        porCategoria[categoria] = [];
        ordenEncontrado.push(categoria);
      }
      porCategoria[categoria].push(lineamiento);
      if (razonActual) razonSocial = razonActual;
    }

    if (ordenEncontrado.length === 0) return null;

    const categoriasFinal = ORDEN_CATEGORIAS.filter((c) => porCategoria[c]);
    ordenEncontrado.forEach((c) => {
      if (categoriasFinal.indexOf(c) === -1) categoriasFinal.push(c);
    });

    return { razonSocial, categorias: categoriasFinal, porCategoria };
  }

  function construirTarjeta(datos) {
    const tarjeta = document.createElement('div');
    tarjeta.className = 'hanna-lineamientos-cliente';
    tarjeta.style.background = '#fff3cd';
    tarjeta.style.border = '1px solid #ffe69c';
    tarjeta.style.borderRadius = '6px';
    tarjeta.style.padding = '12px 14px';
    tarjeta.style.margin = '10px 0';
    tarjeta.style.fontFamily = 'Arial, Helvetica, sans-serif';
    tarjeta.style.fontSize = '13px';
    tarjeta.style.color = '#664d03';
    tarjeta.style.maxHeight = '350px';
    tarjeta.style.overflowY = 'auto';

    const titulo = document.createElement('div');
    titulo.style.fontWeight = 'bold';
    titulo.style.fontSize = '14px';
    titulo.style.marginBottom = '8px';
    titulo.textContent = '⚠️ Lineamientos del cliente' + (datos.razonSocial ? ' — ' + datos.razonSocial : '');
    tarjeta.appendChild(titulo);

    datos.categorias.forEach((categoria) => {
      const encabezado = document.createElement('div');
      encabezado.style.fontWeight = 'bold';
      encabezado.style.marginTop = '8px';
      encabezado.textContent = categoria;
      tarjeta.appendChild(encabezado);

      const lista = document.createElement('ul');
      lista.style.margin = '4px 0 0 0';
      lista.style.paddingLeft = '20px';
      datos.porCategoria[categoria].forEach((texto) => {
        const li = document.createElement('li');
        li.textContent = texto;
        lista.appendChild(li);
      });
      tarjeta.appendChild(lista);
    });

    return tarjeta;
  }

  function procesar(textoCSV, nit, cajaEstado) {
    const filas = parseCSV(textoCSV);
    const datos = agruparLineamientos(filas, nit);
    if (!datos) return; // sin lineamientos para este cliente: no se muestra nada
    const tarjeta = construirTarjeta(datos);
    cajaEstado.insertAdjacentElement('afterend', tarjeta);
  }

  let yaInyectado = false;

  function intentarInyectar() {
    if (yaInyectado) return;

    const { nit } = getClienteEmpresa();
    if (!nit) return; // el bloque "Cliente" con el NIT todavía no cargó

    const cajaEstado = document.querySelector('.boxTopItemDestacado');
    if (!cajaEstado) return; // la tarjeta de "Estado" todavía no está en el DOM

    yaInyectado = true;
    if (observador) observador.disconnect();

    fetch(LINEAMIENTOS_CSV_URL, { cache: 'no-store' })
      .then((r) => r.text())
      .then((texto) => {
        try { localStorage.setItem(CACHE_KEY, texto); } catch (e) { /* sin caché, no pasa nada */ }
        procesar(texto, nit, cajaEstado);
      })
      .catch((err) => {
        console.warn('[Lineamientos Cliente] No se pudo descargar el Sheet, usando última copia guardada.', err);
        let cache = null;
        try { cache = localStorage.getItem(CACHE_KEY); } catch (e) { /* nada que usar */ }
        if (cache) procesar(cache, nit, cajaEstado);
      });
  }

  const observador = new MutationObserver(() => {
    renombrarEtiquetas();
    intentarInyectar();
  });
  observador.observe(document.body, { childList: true, subtree: true });
  renombrarEtiquetas();
  intentarInyectar();

  console.log('[Lineamientos Cliente] v' + APP_VERSION + ' cargado.');
})();