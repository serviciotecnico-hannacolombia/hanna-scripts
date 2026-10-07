// ==UserScript==
// @name         Guardar Contacto en Google Contacts - OT Hanna Colombia
// @namespace    https://intranet.hannacolombia.com/
// @version      1.1.0
// @description  En el detalle de una OT resalta el teléfono del contacto; al hacer clic sobre él (tooltip "Crear contacto") guarda el contacto (nombre, empresa, correo y teléfono, con nombre/apellido/empresa en MAYÚSCULAS) en Google Contacts con la etiqueta "Client" y una foto aleatoria, usando un Google Apps Script propio. No duplica contactos que ya existen.
// @author       Servicio Técnico Hanna Colombia
// @match        https://intranet.hannacolombia.com/stecnico/item/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/contactos-google.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/contactos-google.user.js
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    paisDefault: '57', // Colombia
    claveUrl: 'hanna_contactos_url',
    claveSecreta: 'hanna_contactos_clave',
    claseTel: 'ot-ct-tel',
    claseEstado: 'ot-ct-estado',
  };

  // Solo en el detalle de la OT (.../stecnico/item/NUMERO), no en
  // /diagnosis, /maintenancereport, etc.
  if (!/^\/stecnico\/item\/[^/]+\/?$/.test(window.location.pathname)) return;

  // Regla general de este script: nombre, apellido y empresa en MAYÚSCULAS.
  function mayus(texto) {
    return (texto || '').toLocaleUpperCase('es-CO');
  }

  // ─────────────────────────────────────────────
  // 1. CONFIGURACIÓN (URL del Apps Script + clave), guardada en Tampermonkey
  // ─────────────────────────────────────────────
  function getConfig() {
    return {
      url: (GM_getValue(CONFIG.claveUrl, '') || '').trim(),
      clave: (GM_getValue(CONFIG.claveSecreta, '') || '').trim(),
    };
  }

  function configurar() {
    const actual = getConfig();
    const url = window.prompt(
      'URL de la aplicación web de Apps Script (termina en /exec):',
      actual.url
    );
    if (url === null) return false;
    const clave = window.prompt('Clave secreta (la misma que pusiste en CLAVE en el Apps Script):', actual.clave);
    if (clave === null) return false;
    GM_setValue(CONFIG.claveUrl, url.trim());
    GM_setValue(CONFIG.claveSecreta, clave.trim());
    return Boolean(url.trim() && clave.trim());
  }

  // ─────────────────────────────────────────────
  // 2. LEER LOS DATOS DE LA PÁGINA
  // Se ubica cada fila por su etiqueta visible ("Cliente", "Contacto") y se
  // lee la celda de al lado, sin depender del HTML interno exacto.
  // ─────────────────────────────────────────────
  function celdaValor(etiqueta) {
    const objetivo = etiqueta.toLowerCase();
    for (const el of document.querySelectorAll('th, td, dt, div, span, label, strong, b')) {
      if (el.children.length > 0) continue; // la etiqueta es un nodo de texto simple
      if ((el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() !== objetivo) continue;

      let valor = el.nextElementSibling;
      if (!valor && el.parentElement) valor = el.parentElement.nextElementSibling; // etiqueta envuelta
      if (valor) return valor;
    }
    return null;
  }

  function textoDe(el) {
    if (!el) return null;
    // Se ignora el aviso de estado que este mismo script agrega dentro de la celda
    const copia = el.cloneNode(true);
    copia.querySelectorAll('.' + CONFIG.claseEstado).forEach((n) => n.remove());
    return (copia.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function getCliente() {
    const t = textoDe(celdaValor('Cliente'));
    if (!t) return null;
    // "ECO-LOGIC SOLUCIONES AMBIENTALES SAS NIT: 900950865 Nº Manager: 36237"
    const m = t.match(/^(.+?)\s*(?:NIT\s*:|N[º°o]\s*Manager|$)/i);
    return m && m[1].trim() ? m[1].trim() : null;
  }

  function getContacto() {
    const t = textoDe(celdaValor('Contacto'));
    if (!t) return null;
    // "ANTONIO MARIN LOPEZ Editar E-mail: x@y.co Enviar e-mail Teléfono: 322 5112679"
    const nombre = (t.match(/^(.+?)\s*(?:Editar|E-mail|Tel[eé]fono|$)/i) || [])[1];
    const correo = (t.match(/E-mail\s*:?\s*([^\s]+@[^\s]+)/i) || [])[1];
    const telRaw = (t.match(/Tel[eé]fono\s*:?\s*(.+)$/i) || [])[1];
    return {
      nombre: nombre ? nombre.trim() : null,
      correo: correo ? correo.trim() : null,
      telefonosRaw: telRaw ? telRaw.trim() : null,
    };
  }

  const REGEX_CELULAR = /(\+?57[\s.\-]?)?3(?:[\s.\-]?\d){9}/g;

  // Devuelve los celulares colombianos del texto como "+573001234567".
  // Si no hay ninguno (fijo, extensión, formato raro), devuelve el texto
  // tal cual para no perder el dato.
  function parseTelefonos(raw) {
    if (!raw) return [];
    const matches = raw.match(REGEX_CELULAR) || [];
    const vistos = new Set();
    const salida = [];
    for (const m of matches) {
      let d = m.replace(/\D/g, '');
      if (/^3\d{9}$/.test(d)) d = CONFIG.paisDefault + d;
      else if (!/^573\d{9}$/.test(d)) continue;
      if (!vistos.has(d)) {
        vistos.add(d);
        salida.push('+' + d);
      }
    }
    if (salida.length === 0) {
      const crudo = raw.replace(/\s+/g, ' ').trim();
      if (crudo && /\d/.test(crudo)) salida.push(crudo);
    }
    return salida;
  }

  function leerDatos() {
    const contacto = getContacto();
    if (!contacto || !contacto.nombre) return null;
    return {
      nombre: mayus(contacto.nombre),
      empresa: mayus(getCliente() || ''),
      correo: contacto.correo || '',
      telefonos: parseTelefonos(contacto.telefonosRaw),
    };
  }

  // ─────────────────────────────────────────────
  // 3. ENVIAR AL APPS SCRIPT
  // ─────────────────────────────────────────────
  function enviar(datos, cfg) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: cfg.url,
        // text/plain evita el preflight CORS; el Apps Script lee el cuerpo igual.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        data: JSON.stringify(Object.assign({ clave: cfg.clave }, datos)),
        timeout: 60000,
        onload: (r) => {
          try {
            resolve(JSON.parse(r.responseText));
          } catch (e) {
            reject(new Error('Respuesta inesperada del servidor (¿URL o permisos del Apps Script?)'));
          }
        },
        onerror: () => reject(new Error('No se pudo conectar con el Apps Script')),
        ontimeout: () => reject(new Error('El Apps Script tardó demasiado en responder')),
      });
    });
  }

  // ─────────────────────────────────────────────
  // 4. RESALTAR EL TELÉFONO DETECTADO EN LA PÁGINA
  // Envuelve el número dentro de la celda "Contacto" en un <span> resaltado
  // y clicable. Si no hay teléfono, usa el correo como respaldo para que
  // igual se pueda crear el contacto.
  // ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ot-ct-styles')) return;
    const s = document.createElement('style');
    s.id = 'ot-ct-styles';
    s.textContent = `
      .${CONFIG.claseTel} {
        background: #fff3a3; border-bottom: 2px dotted #e0a800; border-radius: 3px;
        padding: 0 3px; cursor: pointer;
      }
      .${CONFIG.claseTel}:hover { background: #ffe066; }
      .${CONFIG.claseTel}.guardando { opacity: .6; cursor: wait; }
      .${CONFIG.claseTel}.ok { background: #c9f0d1; border-bottom-color: #1e8e3e; }
      .${CONFIG.claseTel}.existe { background: #ffe0b3; border-bottom-color: #f29900; }
      .${CONFIG.claseTel}.error { background: #f9c9c5; border-bottom-color: #d93025; }
      .${CONFIG.claseEstado} { margin-left: 6px; font-size: 12px; color: #444; }
      @media print {
        .${CONFIG.claseTel} { background: none !important; border: none !important; }
        .${CONFIG.claseEstado} { display: none !important; }
      }
    `;
    document.head.appendChild(s);
  }

  function nodosDeTexto(raiz) {
    const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    const nodos = [];
    while (walker.nextNode()) nodos.push(walker.currentNode);
    return nodos;
  }

  function envolver(nodo, inicio, fin) {
    const rango = document.createRange();
    rango.setStart(nodo, inicio);
    rango.setEnd(nodo, fin);
    const span = document.createElement('span');
    span.className = CONFIG.claseTel;
    span.title = 'Crear contacto';
    rango.surroundContents(span);
    return span;
  }

  function resaltarTelefonos(celda) {
    const spans = [];
    const nodos = nodosDeTexto(celda);

    // Celulares: cada coincidencia, de atrás hacia adelante dentro de cada nodo
    for (const nodo of nodos) {
      const texto = nodo.nodeValue;
      const coincidencias = [];
      let m;
      REGEX_CELULAR.lastIndex = 0;
      while ((m = REGEX_CELULAR.exec(texto)) !== null) {
        coincidencias.push({ inicio: m.index, fin: m.index + m[0].length });
      }
      for (let i = coincidencias.length - 1; i >= 0; i--) {
        spans.unshift(envolver(nodo, coincidencias[i].inicio, coincidencias[i].fin));
      }
    }
    if (spans.length) return spans;

    // Sin celular (fijo, formato raro): resalta el texto del campo Teléfono
    for (let i = nodos.length - 1; i >= 0; i--) {
      const texto = nodos[i].nodeValue;
      const sinEtiqueta = texto.replace(/^[\s\S]*?Tel[eé]fono\s*:?\s*/i, '');
      if (sinEtiqueta.replace(/\D/g, '').length < 6) continue; // al menos 6 dígitos en total (admite espacios y paréntesis)
      const inicio = texto.length - sinEtiqueta.length;
      const recortado = sinEtiqueta.replace(/\s+$/, '');
      const lead = sinEtiqueta.length - sinEtiqueta.replace(/^\s+/, '').length;
      spans.push(envolver(nodos[i], inicio + lead, inicio + recortado.length));
      break;
    }
    return spans;
  }

  function resaltarCorreo(celda, correo) {
    if (!correo) return [];
    for (const nodo of nodosDeTexto(celda)) {
      const i = nodo.nodeValue.indexOf(correo);
      if (i !== -1) return [envolver(nodo, i, i + correo.length)];
    }
    return [];
  }

  // ─────────────────────────────────────────────
  // 5. CLIC: CREAR CONTACTO
  // ─────────────────────────────────────────────
  function activar(spans) {
    const ultimo = spans[spans.length - 1];
    const estadoEl = document.createElement('span');
    estadoEl.className = CONFIG.claseEstado;
    ultimo.insertAdjacentElement('afterend', estadoEl);

    function marcar(clase, texto) {
      spans.forEach((sp) => {
        sp.classList.remove('guardando', 'ok', 'existe', 'error');
        if (clase) sp.classList.add(clase);
      });
      estadoEl.textContent = texto || '';
    }

    let ocupado = false;
    async function crear() {
      if (ocupado) return;

      let cfg = getConfig();
      if (!cfg.url || !cfg.clave) {
        if (!configurar()) return;
        cfg = getConfig();
      }

      const datos = leerDatos();
      if (!datos) {
        marcar('error', 'No encontré el contacto en esta página.');
        return;
      }
      if (!datos.correo && datos.telefonos.length === 0) {
        marcar('error', 'El contacto no tiene correo ni teléfono.');
        return;
      }

      ocupado = true;
      marcar('guardando', 'Guardando…');
      try {
        const r = await enviar(datos, cfg);
        if (!r.ok) {
          marcar('error', 'Error: ' + (r.error || 'desconocido'));
        } else if (r.estado === 'existente') {
          marcar('existe', 'Ya existía en tus contactos: ' + r.nombre);
        } else {
          const faltas = [];
          if (r.etiqueta === false) faltas.push('la etiqueta');
          if (r.foto === false) faltas.push('la foto');
          marcar(
            'ok',
            'Guardado: ' + datos.nombre +
              (faltas.length ? ' (no se pudo poner ' + faltas.join(' ni ') + ')' : '')
          );
        }
      } catch (e) {
        marcar('error', e.message);
      } finally {
        ocupado = false;
      }
    }

    spans.forEach((sp) => sp.addEventListener('click', crear));
  }

  function init() {
    if (document.querySelector('.' + CONFIG.claseTel)) return;
    const celda = celdaValor('Contacto');
    if (!celda) return;

    injectStyles();
    const contacto = getContacto();
    let spans = resaltarTelefonos(celda);
    if (!spans.length) spans = resaltarCorreo(celda, contacto && contacto.correo);
    if (!spans.length) return;

    activar(spans);
    GM_registerMenuCommand('Configurar contactos de Google', configurar);
  }

  init();
})();
