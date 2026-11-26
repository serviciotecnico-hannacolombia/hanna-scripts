// ==UserScript==
// @name         Lineamientos del Cliente - Hanna Colombia
// @namespace    https://intranet.hannacolombia.com/
// @version      1.3.0
// @description  Muestra los lineamientos especiales del cliente (por NIT), leídos de Google Sheets, debajo de la tarjeta de Estado; y renombra un par de etiquetas de la tabla de detalle. Todo en "Ver Detalle" de la OT.
// @author       Servicio Técnico Hanna Colombia
// @match        https://intranet.hannacolombia.com/stecnico/item/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/lineamientos-cliente.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/lineamientos-cliente.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Debe coincidir siempre con @version del header de arriba.
  const APP_VERSION = '1.3.0';

  // ─────────────────────────────────────────────
  // CONFIGURACIÓN
  // ─────────────────────────────────────────────
  // Sheet "Patrones de ST", pestaña "lineamientos".
  const SHEET_ID = '1AzJX5B-myRtumple68r7ZXGpE7Xc3nLtkddG5i9rD98';
  const GID_LINEAMIENTOS = '256491155';

  // Lectura EN VIVO (gviz): trae lo que hay en el Sheet en este momento.
  // Solo funciona si el Sheet está compartido como "Cualquier persona con el
  // enlace puede ver"; si no, Google responde 401 y se usa la copia publicada.
  const URL_EN_VIVO = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
    '/gviz/tq?tqx=out:csv&headers=1&gid=' + GID_LINEAMIENTOS;

  // Copia "Publicar en la Web": siempre funciona, pero Google la refresca con
  // varios minutos de retraso (y no todos sus servidores tienen la misma
  // copia al mismo tiempo), así que un cambio recién hecho puede no verse aún.
  const URL_PUBLICADA = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT2t_Y1keodEQiK9Iv4C8PoYmkAe-dFDgVek2z4fAr9IACCV-XDzFvB8jnrBB6J5t4uUwgpwn2W9CSz/pub?gid=' + GID_LINEAMIENTOS + '&single=true&output=csv';

  const CACHE_KEY = 'hanna_lineamientos_cache_v1';
  // Si la lectura en vivo falla (Sheet no compartido), no se vuelve a intentar
  // durante este tiempo, para no hacer una petición inútil en cada OT.
  const EN_VIVO_PAUSA_KEY = 'hanna_lineamientos_envivo_pausa_hasta';
  const EN_VIVO_PAUSA_MS = 30 * 60 * 1000;

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
  // Extracción del NIT del cliente de la página:
  //   Cliente    FRUDELPA FRUTOS DEL PACIFICO S.A.S
  //              NIT: 900947820
  //              Nº Manager: 78967
  // 1) Camino rápido: la fila "Cliente" de la tabla de detalle
  //    (table.detailData, igual que planificador-llamadas.user.js).
  // 2) Respaldo, por si la intranet cambia esa tabla: recorre SOLO los textos
  //    que dicen "NIT" y sube por sus contenedores (mismo criterio que
  //    qr-ordenes-trabajo.user.js: elemento chico, pocos hijos, poco texto),
  //    en vez de leer el texto de TODOS los elementos de la página.
  // ─────────────────────────────────────────────
  const RE_NIT = /NIT:?\s*([\d.\-]{5,20})/i;

  function nitDesdeTablaDetalle() {
    for (const fila of document.querySelectorAll('table.detailData tr')) {
      if (!fila.cells || fila.cells.length < 2) continue;
      if (!/^\s*cliente\s*$/i.test(fila.cells[0].textContent || '')) continue;
      const m = (fila.cells[1].textContent || '').match(RE_NIT);
      return m ? normalizarNit(m[1]) : null;
    }
    return null;
  }

  function nitDesdeTextos() {
    const recorrido = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (/\bNIT\b/i.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    for (let nodo = recorrido.nextNode(); nodo; nodo = recorrido.nextNode()) {
      // El contenedor más externo que siga siendo "chico" (≤ 400 caracteres)
      // y tenga pocos hijos; así entran el NIT y su número aunque estén en
      // etiquetas separadas (ej. <b>NIT:</b> 900947820).
      let elegido = null;
      for (let el = nodo.parentElement; el && el !== document.body; el = el.parentElement) {
        const texto = el.textContent || '';
        if (texto.length > 400) break;
        if (el.children.length <= 6 && RE_NIT.test(texto)) elegido = el;
      }
      if (elegido) return normalizarNit(elegido.textContent.match(RE_NIT)[1]);
    }
    return null;
  }

  function getNitCliente() {
    try {
      return nitDesdeTablaDetalle() || nitDesdeTextos();
    } catch (e) {
      console.warn('[Lineamientos Cliente] No se pudo extraer el NIT del cliente:', e);
      return null;
    }
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

  // ─────────────────────────────────────────────
  // DATOS: hasta tres fuentes, de la menos a la más fresca. Se pinta la más
  // fresca que haya llegado, sin esperar a las demás:
  //   0 = copia guardada en este navegador (instantánea, de la última visita)
  //   1 = copia publicada de Google (puede ir unos minutos atrasada)
  //   2 = lectura en vivo (solo si el Sheet está compartido con enlace)
  // Las descargas arrancan apenas carga el script, en paralelo con la página,
  // en vez de esperar a que la página termine de cargar.
  // ─────────────────────────────────────────────
  let filasActuales = null;
  let prioridadActual = -1;
  let nitCliente = null;
  let cajaEstado = null;
  let tarjetaActual = null;

  function leerLS(clave) {
    try { return localStorage.getItem(clave); } catch (e) { return null; }
  }
  function guardarLS(clave, valor) {
    try { localStorage.setItem(clave, valor); } catch (e) { /* sin caché, no pasa nada */ }
  }

  function esCSVLineamientos(filas) {
    const enc = (filas[0] || []).map((h) => h.trim().toLowerCase());
    return enc.indexOf('nit') > -1 && enc.indexOf('categoria') > -1 && enc.indexOf('lineamiento') > -1;
  }

  // Devuelve true si el texto es un CSV de lineamientos válido (se use o no).
  function recibirCSV(texto, prioridad) {
    const filas = parseCSV(texto || '');
    if (!esCSVLineamientos(filas)) return false;
    if (prioridad < prioridadActual) return true; // ya hay algo más fresco en pantalla
    filasActuales = filas;
    prioridadActual = prioridad;
    if (prioridad > 0) guardarLS(CACHE_KEY, texto);
    pintar();
    return true;
  }

  function descargar(url) {
    return fetch(url, { cache: 'no-store', credentials: 'omit' }).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  function cargarDatos() {
    const copia = leerLS(CACHE_KEY);
    if (copia) recibirCSV(copia, 0);

    const pausaHasta = Number(leerLS(EN_VIVO_PAUSA_KEY)) || 0;
    if (Date.now() >= pausaHasta) {
      descargar(URL_EN_VIVO)
        .then((texto) => {
          if (!recibirCSV(texto, 2)) throw new Error('la respuesta no es el CSV de lineamientos');
        })
        .catch((err) => {
          guardarLS(EN_VIVO_PAUSA_KEY, String(Date.now() + EN_VIVO_PAUSA_MS));
          console.info('[Lineamientos Cliente] Lectura en vivo no disponible (¿el Sheet está compartido con enlace?); se usa la copia publicada.', (err && err.message) || err);
        });
    }

    descargar(URL_PUBLICADA)
      .then((texto) => {
        if (!recibirCSV(texto, 1)) {
          console.warn('[Lineamientos Cliente] No se encontraron las columnas esperadas (NIT/Categoria/Lineamiento) en el Sheet.');
        }
      })
      .catch((err) => {
        console.warn('[Lineamientos Cliente] No se pudo descargar el Sheet publicado; se usa la última copia guardada.', err);
      });
  }

  // Pinta (o actualiza, o quita) la tarjeta con los datos más frescos. Se
  // llama cada vez que llega una fuente nueva y cuando la página ya tiene el
  // NIT y la tarjeta de Estado.
  function pintar() {
    if (!filasActuales || !nitCliente || !cajaEstado) return;
    const datos = agruparLineamientos(filasActuales, nitCliente);
    const nueva = datos ? construirTarjeta(datos) : null;
    // Mismo contenido que ya se ve: no se toca (no parpadea ni pierde el scroll).
    if (tarjetaActual && nueva && tarjetaActual.innerHTML === nueva.innerHTML) return;
    if (tarjetaActual) tarjetaActual.remove();
    tarjetaActual = nueva;
    if (nueva) cajaEstado.insertAdjacentElement('afterend', nueva);
  }

  // ─────────────────────────────────────────────
  // PÁGINA: espera a que estén el NIT y la tarjeta de Estado. Los cambios
  // del DOM se agrupan (una revisión cada 100 ms como mucho) y se deja de
  // vigilar a los 30 s si la OT nunca muestra el NIT.
  // ─────────────────────────────────────────────
  let observador = null;
  let revisionPendiente = false;

  function revisarPagina() {
    revisionPendiente = false;
    renombrarEtiquetas();
    if (!nitCliente) nitCliente = getNitCliente();
    if (!cajaEstado) cajaEstado = document.querySelector('.boxTopItemDestacado');
    if (nitCliente && cajaEstado) {
      if (observador) observador.disconnect();
      pintar();
    }
  }

  function programarRevision() {
    if (revisionPendiente) return;
    revisionPendiente = true;
    setTimeout(revisarPagina, 100);
  }

  function iniciarPagina() {
    revisarPagina();
    if (nitCliente && cajaEstado) return;
    observador = new MutationObserver(programarRevision);
    observador.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observador.disconnect(), 30000);
  }

  cargarDatos();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciarPagina, { once: true });
  } else {
    iniciarPagina();
  }

  console.log('[Lineamientos Cliente] v' + APP_VERSION + ' cargado.');
})();