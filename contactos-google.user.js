// ==UserScript==
// @name         Guardar Contacto en Google Contacts - OT Hanna Colombia
// @namespace    https://intranet.hannacolombia.com/
// @version      1.3.0
// @description  En el detalle de una OT resalta el teléfono del contacto; al hacer clic sobre él (tooltip "Crear contacto") abre un cuadro de confirmación editable (nombre, apellidos, empresa, correo y teléfonos; nombre/apellidos/empresa en MAYÚSCULAS) y, al aceptar, guarda el contacto en Google Contacts con la etiqueta "Client" y una foto aleatoria, usando un Google Apps Script propio. No duplica contactos que ya existen.
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
    // URL de la aplicación web del Apps Script (ya precargada). Solo falta la
    // clave, que se pide la primera vez y queda guardada en tu navegador.
    urlDefault: 'https://script.google.com/macros/s/AKfycbxq_rypjvWVOWdn36hgu-5TxVNFynfOQ8b7wE1LkwDWadQNP9wXWyDhbk1FZRFgz6BocA/exec',
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
      // Si nunca configuraste otra URL, se usa la precargada
      url: (GM_getValue(CONFIG.claveUrl, '') || '').trim() || CONFIG.urlDefault,
      clave: (GM_getValue(CONFIG.claveSecreta, '') || '').trim(),
    };
  }

  // Pide solo la clave (primer uso). La URL ya viene precargada.
  function pedirClave() {
    const clave = window.prompt(
      'Escribe la clave secreta (la misma que pusiste en CLAVE en el Apps Script). Se pide una sola vez:',
      ''
    );
    if (clave === null || !clave.trim()) return false;
    GM_setValue(CONFIG.claveSecreta, clave.trim());
    return true;
  }

  // Desde el menú de Tampermonkey: permite cambiar URL y clave
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
    const cliente = mayus(getCliente() || '');
    return {
      nombre: mayus(contacto.nombre),
      apellidos: cliente, // por defecto, igual que la empresa (editable en el cuadro)
      empresa: cliente,
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
      .ot-ct-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 100000;
        display: flex; align-items: center; justify-content: center; font-family: Arial, sans-serif;
      }
      .ot-ct-dialogo {
        background: #fff; border-radius: 8px; padding: 18px 20px; width: 420px; max-width: 92vw;
        max-height: 92vh; overflow: auto; box-shadow: 0 8px 30px rgba(0,0,0,.35); box-sizing: border-box;
      }
      .ot-ct-dialogo h3 { margin: 0 0 12px; font-size: 16px; color: #222; }
      .ot-ct-dialogo label { display: block; font-size: 12px; color: #555; margin: 10px 0 3px; }
      .ot-ct-dialogo input, .ot-ct-dialogo textarea {
        width: 100%; box-sizing: border-box; padding: 7px 8px; font-size: 14px;
        border: 1px solid #bbb; border-radius: 4px; font-family: inherit;
      }
      .ot-ct-dialogo input:focus, .ot-ct-dialogo textarea:focus { outline: 2px solid #4285f4; border-color: #4285f4; }
      .ot-ct-dialogo .ot-ct-mayus { text-transform: uppercase; }
      .ot-ct-dialogo .ot-ct-ayuda { font-size: 11px; color: #888; margin-top: 2px; }
      .ot-ct-dialogo .ot-ct-error { color: #d93025; font-size: 12px; margin-top: 10px; min-height: 14px; }
      .ot-ct-dialogo .ot-ct-botones { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
      .ot-ct-dialogo button {
        padding: 8px 16px; font-size: 14px; border-radius: 4px; cursor: pointer; border: 1px solid #bbb; background: #f5f5f5;
      }
      .ot-ct-dialogo button.ot-ct-aceptar { background: #4285f4; border-color: #4285f4; color: #fff; }
      .ot-ct-dialogo button.ot-ct-aceptar:hover { background: #3367d6; }
      @media print {
        .ot-ct-overlay { display: none !important; }
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
  // 5a. CUADRO DE CONFIRMACIÓN (editable)
  // Permite corregir nombre, quitar un apellido, etc. antes de crear.
  // Resuelve con los datos finales, o null si se cancela.
  // ─────────────────────────────────────────────
  function abrirConfirmacion(datos) {
    return new Promise((resolve) => {
      const previo = document.querySelector('.ot-ct-overlay');
      if (previo) previo.remove();

      const overlay = document.createElement('div');
      overlay.className = 'ot-ct-overlay';
      overlay.innerHTML = `
        <div class="ot-ct-dialogo" role="dialog" aria-modal="true" aria-label="Crear contacto">
          <h3>Crear contacto en Google Contacts</h3>
          <label>Nombre</label>
          <input type="text" class="ot-ct-mayus" data-campo="nombre" autocomplete="off">
          <label>Apellidos</label>
          <input type="text" class="ot-ct-mayus" data-campo="apellidos" autocomplete="off">
          <label>Empresa</label>
          <input type="text" class="ot-ct-mayus" data-campo="empresa" autocomplete="off">
          <label>Correo</label>
          <input type="text" data-campo="correo" autocomplete="off">
          <label>Teléfonos</label>
          <textarea rows="2" data-campo="telefonos"></textarea>
          <div class="ot-ct-ayuda">Uno por línea. Los celulares colombianos se guardan con +57.</div>
          <div class="ot-ct-error"></div>
          <div class="ot-ct-botones">
            <button type="button" class="ot-ct-cancelar">Cancelar</button>
            <button type="button" class="ot-ct-aceptar">Aceptar</button>
          </div>
        </div>`;

      const campo = (n) => overlay.querySelector(`[data-campo="${n}"]`);
      campo('nombre').value = datos.nombre || '';
      campo('apellidos').value = datos.apellidos || '';
      campo('empresa').value = datos.empresa || '';
      campo('correo').value = datos.correo || '';
      campo('telefonos').value = (datos.telefonos || []).join('\n');

      // Mayúsculas reales (no solo visuales) mientras se escribe, sin mover el cursor
      overlay.querySelectorAll('.ot-ct-mayus').forEach((inp) => {
        inp.addEventListener('input', () => {
          const pos = inp.selectionStart;
          const v = mayus(inp.value);
          if (v !== inp.value) {
            inp.value = v;
            try { inp.setSelectionRange(pos, pos); } catch (e) {}
          }
        });
      });

      const errorEl = overlay.querySelector('.ot-ct-error');

      function cerrar(resultado) {
        document.removeEventListener('keydown', alTeclear, true);
        overlay.remove();
        resolve(resultado);
      }

      function aceptar() {
        const nombre = mayus(campo('nombre').value.replace(/\s+/g, ' ').trim());
        const apellidos = mayus(campo('apellidos').value.replace(/\s+/g, ' ').trim());
        const empresa = mayus(campo('empresa').value.replace(/\s+/g, ' ').trim());
        const correo = campo('correo').value.trim();

        const vistos = new Set();
        const telefonos = [];
        campo('telefonos').value.split(/[\n,;]+/).forEach((linea) => {
          parseTelefonos(linea).forEach((t) => {
            if (!vistos.has(t)) { vistos.add(t); telefonos.push(t); }
          });
        });

        if (!nombre) { errorEl.textContent = 'El nombre no puede quedar vacío.'; campo('nombre').focus(); return; }
        if (correo && !/^[^\s@]+@[^\s@]+$/.test(correo)) { errorEl.textContent = 'El correo no parece válido.'; campo('correo').focus(); return; }
        if (!correo && telefonos.length === 0) { errorEl.textContent = 'Debe tener al menos un correo o un teléfono.'; return; }

        cerrar({ nombre, apellidos, empresa, correo, telefonos });
      }

      function alTeclear(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(null); }
        else if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && overlay.contains(e.target)) {
          e.preventDefault(); aceptar();
        }
      }

      overlay.querySelector('.ot-ct-aceptar').addEventListener('click', aceptar);
      overlay.querySelector('.ot-ct-cancelar').addEventListener('click', () => cerrar(null));
      document.addEventListener('keydown', alTeclear, true);

      document.body.appendChild(overlay);
      campo('nombre').focus();
    });
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
      if (!cfg.clave) {
        if (!pedirClave()) return;
        cfg = getConfig();
      }

      const inicial = leerDatos();
      if (!inicial) {
        marcar('error', 'No encontré el contacto en esta página.');
        return;
      }

      ocupado = true; // evita abrir dos cuadros a la vez
      const datos = await abrirConfirmacion(inicial);
      ocupado = false;
      if (!datos) return; // canceló: no se envía nada

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