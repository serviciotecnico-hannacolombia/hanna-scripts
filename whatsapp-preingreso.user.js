// ==UserScript==
// @name         WhatsApp desde Teléfono - Pre-Ingreso Hanna Colombia
// @namespace    https://intranet.hannacolombia.com/
// @version      1.1.0
// @description  Detecta uno o varios teléfonos celulares en el campo "Contacto Teléfono" del Pre-Ingreso y muestra un botón de WhatsApp por cada uno con un mensaje predeterminado (incluye el primer nombre del contacto, el número de Pre-Ingreso y tu nombre configurado). Incluye botón ⚙️ para configurar tu nombre.
// @author       Servicio Técnico Hanna Colombia
// @match        https://intranet.hannacolombia.com/stecnico/pre_ingreso/item/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/whatsapp-preingreso.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/whatsapp-preingreso.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ─────────────────────────────────────────────
  // CONFIGURACIÓN
  // ─────────────────────────────────────────────
  const CONFIG = {
    containerId: 'preingreso-wa-container',
    paisDefault: '57', // Colombia
    // Clave de localStorage COMPARTIDA con el script "WhatsApp OT": si
    // configuras tu nombre en un script, el otro también lo usa.
    storageKeyNombre: 'hanna_nombre_tecnico',
  };

  // ─────────────────────────────────────────────
  // 0. NOMBRE DEL TÉCNICO/ASESOR (configurable por cada usuario)
  // Se guarda en localStorage del navegador de cada persona, así el
  // mismo script sirve para cualquier técnico sin tener un nombre
  // hardcodeado. Si nadie lo ha configurado, el mensaje simplemente
  // omite el nombre del asesor.
  // ─────────────────────────────────────────────
  function getNombreTecnico() {
    try {
      const v = localStorage.getItem(CONFIG.storageKeyNombre);
      return v && v.trim() ? v.trim() : null;
    } catch (e) {
      return null;
    }
  }

  function setNombreTecnico(nombre) {
    try {
      if (nombre && nombre.trim()) {
        localStorage.setItem(CONFIG.storageKeyNombre, nombre.trim());
      } else {
        localStorage.removeItem(CONFIG.storageKeyNombre);
      }
      return true;
    } catch (e) {
      console.warn('[Pre-Ingreso WhatsApp] No se pudo guardar el nombre configurado:', e);
      return false;
    }
  }

  function abrirConfiguracionNombre() {
    const actual = getNombreTecnico() || '';
    const respuesta = window.prompt(
      'Configura tu nombre para los mensajes de WhatsApp (se usará en este equipo y en el script de WhatsApp OT).\n\nDéjalo vacío para no incluir tu nombre en el mensaje.',
      actual
    );
    if (respuesta === null) return; // canceló, no cambia nada
    setNombreTecnico(respuesta);
    // Recargamos para que el mensaje ya construido se regenere con el nuevo nombre.
    window.location.reload();
  }

  // ─────────────────────────────────────────────
  // 1. OBTENER NÚMERO DE PRE-INGRESO
  //    Primero intenta leerlo del encabezado ("Pre-Ingreso 132"),
  //    si no lo encuentra, busca el campo "ID" de la tabla.
  // ─────────────────────────────────────────────
  function getPreIngresoId() {
    // Buscar en encabezados tipo <h1>Pre-Ingreso 132</h1>
    const headings = document.querySelectorAll('h1, h2, h3');
    for (const h of headings) {
      const m = (h.textContent || '').match(/Pre-?Ingreso\s+(\d+)/i);
      if (m) return m[1];
    }
    // Fallback: campo "ID" en la tabla
    const idVal = getFieldValue('ID');
    if (idVal && /^\d+$/.test(idVal.trim())) return idVal.trim();
    return null;
  }

  // ─────────────────────────────────────────────
  // 2. OBTENER VALOR DE UN CAMPO POR SU ETIQUETA
  //    Busca una celda (td/th) cuyo texto coincida exactamente con
  //    "label" y devuelve el texto de la siguiente celda con contenido.
  // ─────────────────────────────────────────────
  function getFieldValue(label) {
    try {
      const cells = document.querySelectorAll('td, th');
      for (const cell of cells) {
        const txt = (cell.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt.toLowerCase() === label.toLowerCase()) {
          let sib = cell.nextElementSibling;
          while (sib) {
            const v = (sib.textContent || '').replace(/\s+/g, ' ').trim();
            if (v) return v;
            sib = sib.nextElementSibling;
          }
        }
      }
    } catch (e) {
      console.warn('[Pre-Ingreso WhatsApp] Error buscando campo "' + label + '":', e);
    }
    return null;
  }

  // ─────────────────────────────────────────────
  // 3. NORMALIZAR NOMBRE: solo el primer nombre,
  //    primera letra mayúscula y el resto minúscula.
  // ─────────────────────────────────────────────
  function normalizarPrimerNombre(raw) {
    if (!raw) return null;

    const cleaned = raw.trim();
    if (!cleaned) return null;

    const primeraPalabra = cleaned.split(/\s+/)[0];

    if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+$/.test(primeraPalabra)) {
      return null;
    }
    if (primeraPalabra.length < 2) return null;

    const lower = primeraPalabra.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  // ─────────────────────────────────────────────
  // 4. CONSTRUIR MENSAJE PREDETERMINADO
  // ─────────────────────────────────────────────
  function buildMensaje(nombre, preIngresoId) {
    const idTexto = preIngresoId ? preIngresoId : '';
    const saludo = nombre ? `Hola muy buen día, ${nombre} ,` : 'Hola muy buen día,';
    const nombreTecnico = getNombreTecnico();
    const presentacion = nombreTecnico
      ? `hablas con ${nombreTecnico} del Servicio Técnico de Hanna Instruments.`
      : 'hablas con el Servicio Técnico de Hanna Instruments.';

    return `${saludo} ¿Cómo estas? ${presentacion} Te escribo al respecto del equipo o equipos que tienes registrado en el pre ingreso ${idTexto}`;
  }

  // ─────────────────────────────────────────────
  // 5. VALIDAR / EXTRAER TODOS LOS NÚMEROS CELULARES VÁLIDOS
  // (misma lógica que el script de OT: celulares colombianos,
  // acepta separadores, con o sin +57, ignora fijos y extensiones)
  // ─────────────────────────────────────────────
  function parseTelefonos(raw) {
    const result = { valido: false, numeros: [], motivo: null };

    if (!raw) {
      result.motivo = 'No se encontró el campo Contacto Teléfono';
      return result;
    }

    if (/\bext\.?\s*\(?\d+\)?/i.test(raw) || /\binterno\b/i.test(raw) || /\bx\d{2,4}\b/i.test(raw)) {
      result.motivo = 'El número tiene una extensión (no aplica a WhatsApp)';
      return result;
    }

    const celularRegex = /(\+?57[\s.\-]?)?3(?:[\s.\-]?\d){9}/g;
    const matches = raw.match(celularRegex);

    if (!matches || matches.length === 0) {
      result.motivo = 'No se encontró un número celular válido';
      return result;
    }

    const vistos = new Set();
    for (const m of matches) {
      let digits = m.replace(/\D/g, '');

      if (/^3\d{9}$/.test(digits)) {
        digits = CONFIG.paisDefault + digits;
      } else if (!/^573\d{9}$/.test(digits)) {
        continue;
      }

      if (!vistos.has(digits)) {
        vistos.add(digits);
        result.numeros.push(digits);
      }
    }

    if (result.numeros.length === 0) {
      result.motivo = 'El número encontrado no parece un celular colombiano válido';
      return result;
    }

    result.valido = true;
    return result;
  }

  function buildWhatsAppUrl(digits, mensaje) {
    const base = `https://wa.me/${digits}`;
    if (!mensaje) return base;
    return `${base}?text=${encodeURIComponent(mensaje)}`;
  }

  // ─────────────────────────────────────────────
  // 6. ESTILOS
  // ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('preingreso-wa-styles')) return;
    const s = document.createElement('style');
    s.id = 'preingreso-wa-styles';
    s.textContent = `
      #${CONFIG.containerId} {
        position      : fixed;
        bottom        : 16px;
        right         : 16px;
        z-index       : 9999;
        font-family   : Arial, sans-serif;
        display       : flex;
        flex-direction: column;
        align-items   : flex-end;
        gap           : 10px;
      }
      #${CONFIG.containerId} .ot-wa-btn {
        display        : flex;
        align-items    : center;
        justify-content: center;
        width          : 48px;
        height         : 48px;
        background     : #25D366;
        color          : #ffffff;
        border         : none;
        border-radius  : 50%;
        cursor         : pointer;
        text-decoration: none;
        box-shadow     : 0 2px 8px rgba(0,0,0,0.25);
        box-sizing     : border-box;
      }
      #${CONFIG.containerId} .ot-wa-btn:hover {
        background: #1ebe57;
      }
      #${CONFIG.containerId} .ot-wa-btn svg {
        width : 26px;
        height: 26px;
        flex  : 0 0 auto;
      }
      #${CONFIG.containerId} .ot-wa-invalid {
        display        : flex;
        align-items    : center;
        justify-content: center;
        width          : 48px;
        height         : 48px;
        background     : #e0e0e0;
        color          : #c0392b;
        border         : none;
        border-radius  : 50%;
        box-shadow     : 0 2px 8px rgba(0,0,0,0.25);
        box-sizing     : border-box;
        cursor         : default;
      }
      #${CONFIG.containerId} .ot-wa-invalid svg {
        width : 26px;
        height: 26px;
        flex  : 0 0 auto;
        opacity: 0.6;
      }
      #${CONFIG.containerId} .ot-wa-config {
        display        : flex;
        align-items    : center;
        justify-content: center;
        width          : 30px;
        height         : 30px;
        background     : #ffffff;
        color          : #555;
        border         : 1px solid #ccc;
        border-radius  : 50%;
        cursor         : pointer;
        font-size      : 15px;
        box-shadow     : 0 1px 4px rgba(0,0,0,0.2);
      }
      #${CONFIG.containerId} .ot-wa-config:hover {
        background: #f0f0f0;
      }

      @media print {
        #${CONFIG.containerId} { display: none !important; }
      }
    `;
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────
  // 7. ICONO WHATSAPP
  // ─────────────────────────────────────────────
  const WHATSAPP_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.47 14.38c-.29-.15-1.7-.84-1.96-.93-.26-.1-.46-.15-.65.15-.19.29-.74.93-.91 1.12-.17.19-.34.21-.62.07-.29-.15-1.21-.45-2.31-1.43-.85-.76-1.43-1.7-1.6-1.99-.17-.29-.02-.44.13-.59.15-.15.34-.38.51-.58.17-.19.22-.34.34-.57.12-.23.05-.43-.04-.58-.1-.15-.91-2.2-1.25-2.97-.29-.65-.59-.55-.8-.56-.21-.01-.46-.01-.71-.01-.24 0-.63.1-.96.44-.34.34-1.3 1.27-1.3 3.09 0 1.82 1.32 3.58 1.5 3.83.19.24 2.61 4 6.34 5.44 3.73 1.45 3.73.97 4.41.91.68-.06 2.19-.89 2.49-1.76.31-.87.31-1.61.21-1.76-.09-.15-.34-.24-.62-.39z"/>
    </svg>
  `;

  // ─────────────────────────────────────────────
  // 8. CONSTRUIR DOM
  // ─────────────────────────────────────────────
  function buildContainer(parsed, rawTelefono, mensaje) {
    const wrap = document.createElement('div');
    wrap.id = CONFIG.containerId;

    if (parsed.valido) {
      parsed.numeros.forEach((digits) => {
        const btn = document.createElement('a');
        btn.className = 'ot-wa-btn';
        btn.href = buildWhatsAppUrl(digits, mensaje);
        btn.target = '_blank';
        btn.rel = 'noopener noreferrer';
        btn.title = `Abrir WhatsApp: +${digits}`;
        btn.innerHTML = WHATSAPP_ICON_SVG;
        wrap.appendChild(btn);
      });
    } else {
      const invalidBox = document.createElement('div');
      invalidBox.className = 'ot-wa-invalid';
      const motivo = parsed.motivo || 'No se pudo determinar el número';
      invalidBox.title = rawTelefono
        ? `Teléfono no válido: ${motivo} ("${rawTelefono}")`
        : `Teléfono no válido: ${motivo}`;
      invalidBox.innerHTML = WHATSAPP_ICON_SVG;
      wrap.appendChild(invalidBox);
    }

    const configBtn = document.createElement('button');
    configBtn.type = 'button';
    configBtn.className = 'ot-wa-config';
    const nombreActual = getNombreTecnico();
    configBtn.title = nombreActual
      ? `Configurar tu nombre (actual: ${nombreActual})`
      : 'Configurar tu nombre para los mensajes de WhatsApp';
    configBtn.textContent = '⚙️';
    configBtn.addEventListener('click', abrirConfiguracionNombre);
    wrap.appendChild(configBtn);

    document.body.appendChild(wrap);
  }

  // ─────────────────────────────────────────────
  // 9. INICIO
  // ─────────────────────────────────────────────
  function init() {
    if (document.getElementById(CONFIG.containerId)) return;

    const proceed = () => {
      const rawTelefono = getFieldValue('Contacto Teléfono');
      const parsed = parseTelefonos(rawTelefono);

      const preIngresoId = getPreIngresoId();
      const nombreRaw = getFieldValue('Contacto Nombre');
      const nombre = normalizarPrimerNombre(nombreRaw);
      const mensaje = buildMensaje(nombre, preIngresoId);

      console.log('[Pre-Ingreso WhatsApp] Texto crudo teléfono:', rawTelefono);
      console.log('[Pre-Ingreso WhatsApp] Resultado parseo teléfono:', parsed);
      console.log('[Pre-Ingreso WhatsApp] Nombre crudo:', nombreRaw, '-> normalizado:', nombre);
      console.log('[Pre-Ingreso WhatsApp] Número Pre-Ingreso:', preIngresoId);
      console.log('[Pre-Ingreso WhatsApp] Mensaje:', mensaje);

      injectStyles();
      buildContainer(parsed, rawTelefono, mensaje);
    };

    if (getFieldValue('Contacto Teléfono')) {
      proceed();
    } else {
      // Reintento por si el contenido carga de forma asíncrona
      setTimeout(proceed, 1000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
