// ==UserScript==
// @name         WhatsApp desde Teléfono OT - Hanna Colombia
// @namespace    https://intranet.hannacolombia.com/
// @version      1.3.0
// @description  Detecta uno o varios teléfonos celulares en el bloque "Contacto" de la OT y muestra un botón de WhatsApp por cada uno con un mensaje predeterminado (incluye el primer nombre del contacto, el número de OT y tu nombre configurado), o un aviso "Teléfono no válido" si no se puede determinar ninguno. Incluye botón ⚙️ para configurar tu nombre.
// @author       Servicio Técnico Hanna Colombia
// @match        https://intranet.hannacolombia.com/stecnico/item/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/whatsapp-ot.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/whatsapp-ot.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ─────────────────────────────────────────────
  // CONFIGURACIÓN
  // ─────────────────────────────────────────────
  const CONFIG = {
    containerId: 'ot-wa-container',
    paisDefault: '57', // Colombia
    // Clave de localStorage COMPARTIDA con el script "WhatsApp Pre-Ingreso":
    // si configuras tu nombre en un script, el otro también lo usa.
    storageKeyNombre: 'hanna_nombre_tecnico',
  };

  // ─────────────────────────────────────────────
  // 0. NOMBRE DEL TÉCNICO (configurable por cada usuario)
  // Se guarda en localStorage del navegador de cada persona, así el
  // mismo script sirve para cualquier técnico sin tener un nombre
  // hardcodeado. Si nadie lo ha configurado, el mensaje simplemente
  // omite el nombre del técnico.
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
      console.warn('[OT WhatsApp] No se pudo guardar el nombre configurado:', e);
      return false;
    }
  }

  function abrirConfiguracionNombre() {
    const actual = getNombreTecnico() || '';
    const respuesta = window.prompt(
      'Configura tu nombre para los mensajes de WhatsApp (se usará en este equipo y en el script de WhatsApp Pre-Ingreso).\n\nDéjalo vacío para no incluir tu nombre en el mensaje.',
      actual
    );
    if (respuesta === null) return; // canceló, no cambia nada
    setNombreTecnico(respuesta);
    // Recargamos para que el mensaje ya construido se regenere con el nuevo nombre.
    window.location.reload();
  }

  // ─────────────────────────────────────────────
  // 1. OBTENER ID DE LA OT DESDE LA URL
  // ─────────────────────────────────────────────
  function getOrderId() {
    const segs = window.location.pathname.split('/').filter(Boolean);
    const i = segs.indexOf('item');
    const id = i !== -1 ? segs[i + 1] : null;
    return (id && /^[a-zA-Z0-9\-_]+$/.test(id)) ? id : null;
  }

  // ─────────────────────────────────────────────
  // 2. OBTENER TEXTO CRUDO DEL TELÉFONO DESDE "Contacto"
  // ─────────────────────────────────────────────
  function getTelefonoRaw() {
    try {
      for (const el of document.querySelectorAll('*')) {
        if (el.children.length > 8) continue;
        const text = el.textContent || '';

        if (/\bcontacto\b/i.test(text) && text.length < 500) {
          const cleaned = text.replace(/\s+/g, ' ').trim();
          const m = cleaned.match(/Tel[eé]fono\s*:?\s*([^\n]+?)(?:\s{2,}|$)/i);
          if (m) return m[1].trim();

          // Fallback: si "Teléfono:" está pegado a otro campo, capturamos
          // hasta el siguiente label conocido o fin de bloque.
          const m2 = cleaned.match(/Tel[eé]fono\s*:?\s*(.+?)(?:E-mail|Editar|$)/i);
          if (m2) return m2[1].trim();
        }
      }
    } catch (e) {
      console.warn('[OT WhatsApp] Error buscando teléfono:', e);
    }
    return null;
  }

  // ─────────────────────────────────────────────
  // 3. OBTENER NOMBRE DE CONTACTO DESDE LA PÁGINA
  // Busca el bloque "Contacto" y extrae el texto antes
  // de "Editar" / "E-mail" / "Teléfono".
  // ─────────────────────────────────────────────
  function getContactNameRaw() {
    try {
      for (const el of document.querySelectorAll('*')) {
        if (el.children.length > 8) continue;
        const text = el.textContent || '';

        if (/\bcontacto\b/i.test(text) && text.length < 500) {
          const cleaned = text.replace(/\s+/g, ' ').trim();

          // Texto entre "Contacto" y "Editar"/"E-mail"/"Teléfono"
          const m = cleaned.match(/contacto\s+(.+?)\s*(Editar|E-mail|Tel[eé]fono|$)/i);
          if (m) return m[1].trim();
        }
      }
    } catch (e) {
      console.warn('[OT WhatsApp] Error buscando nombre de contacto:', e);
    }
    return null;
  }

  // ─────────────────────────────────────────────
  // 4. NORMALIZAR NOMBRE: solo el primer nombre,
  // primera letra mayúscula y el resto minúscula.
  // Si no es un nombre real (vacío, guiones, números,
  // símbolos) devuelve null.
  // ─────────────────────────────────────────────
  function normalizarPrimerNombre(raw) {
    if (!raw) return null;

    const cleaned = raw.trim();
    if (!cleaned) return null;

    // Toma solo la primera "palabra" (separada por espacios)
    const primeraPalabra = cleaned.split(/\s+/)[0];

    // Debe contener únicamente letras (incluye acentos/ñ) para ser válido.
    // Esto descarta cosas como "---", "N/A", "123", "S.A.S", etc.
    if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+$/.test(primeraPalabra)) {
      return null;
    }

    // Exige un mínimo de 2 letras para evitar iniciales sueltas o ruido.
    if (primeraPalabra.length < 2) return null;

    const lower = primeraPalabra.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  // ─────────────────────────────────────────────
  // 5. CONSTRUIR MENSAJE PREDETERMINADO
  // ─────────────────────────────────────────────
  function buildMensaje(nombre, orderId) {
    const otTexto = orderId ? `OTST ${orderId}` : 'OTST';
    const nombreTecnico = getNombreTecnico();
    const presentacion = nombreTecnico
      ? `hablas con ${nombreTecnico} del Servicio Técnico de Hanna Instruments.`
      : 'hablas con el Servicio Técnico de Hanna Instruments.';

    if (nombre) {
      return `Hola muy buen día, ${nombre}, ¿Cómo estas? ${presentacion} Te escribo al respecto del equipo que nos enviaste para revisión (${otTexto})`;
    }
    return `Hola muy buen día, ¿Cómo estas? ${presentacion} Te escribo al respecto del equipo que nos enviaste para revisión (${otTexto})`;
  }

  // ─────────────────────────────────────────────
  // 6. VALIDAR / EXTRAER TODOS LOS NÚMEROS CELULARES VÁLIDOS
  //
  // Reglas:
  //  - Si el texto menciona extensión/interno -> inválido (todo el campo).
  //  - Se buscan TODOS los números celulares colombianos presentes,
  //    sin importar el separador entre ellos ("-", "/", ",", ";", " o ", " y ").
  //  - Acepta separadores internos: espacios, guiones, puntos.
  //  - Acepta con o sin +57 / 57 de código de país.
  //  - Solo se consideran celulares colombianos: 10 dígitos que
  //    empiezan en 3 (con o sin prefijo 57/+57).
  //  - Números fijos (7-8 dígitos) -> se ignoran (no tienen WhatsApp).
  //  - Si no se encuentra ningún celular válido -> inválido.
  // ─────────────────────────────────────────────
  function parseTelefonos(raw) {
    const result = { valido: false, numeros: [], motivo: null };

    if (!raw) {
      result.motivo = 'No se encontró el campo Teléfono';
      return result;
    }

    // 1) Detectar extensión / interno -> inválido directo
    if (/\bext\.?\s*\(?\d+\)?/i.test(raw) || /\binterno\b/i.test(raw) || /\bx\d{2,4}\b/i.test(raw)) {
      result.motivo = 'El número tiene una extensión (no aplica a WhatsApp)';
      return result;
    }

    // 2) Buscar TODOS los patrones de celular colombiano en el texto.
    //    Acepta separador (espacio, guion o punto) opcional ENTRE CUALQUIER
    //    PAR DE DÍGITOS, sin importar cómo estén agrupados visualmente
    //    (ej. "315 532 61 54", "315-5326154", "315 5326154").
    const celularRegex = /(\+?57[\s.\-]?)?3(?:[\s.\-]?\d){9}/g;
    const matches = raw.match(celularRegex);

    if (!matches || matches.length === 0) {
      result.motivo = 'No se encontró un número celular válido';
      return result;
    }

    // 3) Limpiar, validar y deduplicar cada coincidencia
    const vistos = new Set();
    for (const m of matches) {
      let digits = m.replace(/\D/g, '');

      if (/^3\d{9}$/.test(digits)) {
        digits = CONFIG.paisDefault + digits;
      } else if (!/^573\d{9}$/.test(digits)) {
        continue; // no es un celular colombiano válido, se ignora
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
  // 7. ESTILOS
  // ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ot-wa-styles')) return;
    const s = document.createElement('style');
    s.id = 'ot-wa-styles';
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
  // 8. ICONO WHATSAPP (solo el glifo del teléfono, sin contorno/burbuja)
  // ─────────────────────────────────────────────
  const WHATSAPP_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.47 14.38c-.29-.15-1.7-.84-1.96-.93-.26-.1-.46-.15-.65.15-.19.29-.74.93-.91 1.12-.17.19-.34.21-.62.07-.29-.15-1.21-.45-2.31-1.43-.85-.76-1.43-1.7-1.6-1.99-.17-.29-.02-.44.13-.59.15-.15.34-.38.51-.58.17-.19.22-.34.34-.57.12-.23.05-.43-.04-.58-.1-.15-.91-2.2-1.25-2.97-.29-.65-.59-.55-.8-.56-.21-.01-.46-.01-.71-.01-.24 0-.63.1-.96.44-.34.34-1.3 1.27-1.3 3.09 0 1.82 1.32 3.58 1.5 3.83.19.24 2.61 4 6.34 5.44 3.73 1.45 3.73.97 4.41.91.68-.06 2.19-.89 2.49-1.76.31-.87.31-1.61.21-1.76-.09-.15-.34-.24-.62-.39z"/>
    </svg>
  `;

  // ─────────────────────────────────────────────
  // 9. CONSTRUIR DOM
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
  // 10. INICIO
  // ─────────────────────────────────────────────
  function init() {
    if (document.getElementById(CONFIG.containerId)) return;

    const proceed = () => {
      const rawTelefono = getTelefonoRaw();
      const parsed = parseTelefonos(rawTelefono);

      const orderId = getOrderId();
      const nombreRaw = getContactNameRaw();
      const nombre = normalizarPrimerNombre(nombreRaw);
      const mensaje = buildMensaje(nombre, orderId);

      console.log('[OT WhatsApp] Texto crudo teléfono:', rawTelefono);
      console.log('[OT WhatsApp] Resultado parseo teléfono:', parsed);
      console.log('[OT WhatsApp] Nombre crudo:', nombreRaw, '-> normalizado:', nombre);
      console.log('[OT WhatsApp] Mensaje:', mensaje);

      injectStyles();
      buildContainer(parsed, rawTelefono, mensaje);
    };

    if (getTelefonoRaw()) {
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
