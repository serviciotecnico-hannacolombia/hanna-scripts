// ==UserScript==
// @name         QR Órdenes de Trabajo - Hanna Colombia
// @namespace    https://intranet.hannacolombia.com/
// @version      2.6.0
// @description  QR con ID-MM-AAAA|NIT|NOMBRE|EMAIL del cliente codificados. Un solo canvas 100x100px, mes y año como texto debajo. Incluye botón para copiar el texto codificado al portapapeles.
// @author       Servicio Técnico Hanna Colombia
// @match        https://intranet.hannacolombia.com/stecnico/item/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/qr-ordenes-trabajo.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/qr-ordenes-trabajo.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ─────────────────────────────────────────────
  // CONFIGURACIÓN
  // ─────────────────────────────────────────────
  const CONFIG = {
    containerId: 'ot-qr-container',
    qrCdn      : 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
    qrSize     : 130,
  };

  const MESES = {
    enero:'01', febrero:'02', marzo:'03', abril:'04',
    mayo:'05', junio:'06', julio:'07', agosto:'08',
    septiembre:'09', octubre:'10', noviembre:'11', diciembre:'12',
  };

  // ─────────────────────────────────────────────
  // 1. ID DESDE URL
  // ─────────────────────────────────────────────
  function getOrderId() {
    const segs = window.location.pathname.split('/').filter(Boolean);
    const i = segs.indexOf('item');
    const id = i !== -1 ? segs[i + 1] : null;
    return (id && /^[a-zA-Z0-9\-_]+$/.test(id)) ? id : null;
  }

  // ─────────────────────────────────────────────
  // 2. FECHA DE CREACIÓN DESDE LA PÁGINA
  // ─────────────────────────────────────────────
  function getCreationDate() {
    try {
      for (const el of document.querySelectorAll('*')) {
        if (el.children.length > 3) continue;
        const text = el.textContent || '';
        if (/fecha\s+creaci[oó]n/i.test(text)) {
          const m = text.match(
            /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)[,\s]+(\d{4})/i
          );
          if (m) {
            const key = m[1].toLowerCase();
            return {
              mesNum   : MESES[key],
              anio     : m[2],
              mesNombre: m[1].charAt(0).toUpperCase() + key.slice(1),
            };
          }
        }
      }
    } catch(e) {}
    return null;
  }

  // ─────────────────────────────────────────────
  // 3. CONTACTO (persona que lleva el equipo) — nombre y correo
  // Formato esperado en la página:
  //   Contacto   JAIRO ENRIQUE ORDOÑEZ
  //              E-mail: directorpro@naturalsherbeats.co
  // ─────────────────────────────────────────────
  function getContactoData() {
    const result = { nombre: null, email: null };
    try {
      for (const el of document.querySelectorAll('*')) {
        if (el.children.length > 5) continue;
        const text = el.textContent || '';

        // Buscar bloque que contenga "Contacto"
        if (/\bcontacto\b/i.test(text) && text.length < 400) {

          // Extraer email — patrón estándar
          const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
          if (emailMatch) result.email = emailMatch[0].trim();

          // Extraer nombre — buscar después de "Contacto" y antes de "E-mail"
          const cleaned = text.replace(/\s+/g, ' ').trim();

          const nombreMatch = cleaned.match(/contacto\s+([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑA-Za-záéíóúüñ\s]{3,60?})\s+(E-mail|Tel[eé]fono|Editar)/i);
          if (nombreMatch) {
            result.nombre = nombreMatch[1].trim();
          }

          if (!result.nombre) {
            const editarMatch = cleaned.match(/([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\s]{5,50})\s*(✎|Editar)/i);
            if (editarMatch) result.nombre = editarMatch[1].trim();
          }

          if (result.email || result.nombre) break;
        }
      }
    } catch(e) {
      console.warn('[OT QR] No se pudieron extraer datos de contacto:', e);
    }
    return result;
  }

  // ─────────────────────────────────────────────
  // 4. CLIENTE (empresa) — nombre y NIT
  // Formato esperado en la página:
  //   Cliente    FRUDELPA FRUTOS DEL PACIFICO S.A.S
  //              NIT: 900947820
  //              Nº Manager: 78967
  // Es un bloque distinto de "Contacto": el NIT identifica a la empresa de
  // forma estable aunque cambie quién lleva el equipo a servicio técnico.
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
        const nombreMatch = cleaned.match(/cliente\s+([A-ZÁÉÍÓÚÜÑ0-9][A-ZÁÉÍÓÚÜÑ0-9A-Za-záéíóúüñ.,&\s-]{3,80?})\s+NIT/i);

        result.nit = nitMatch[1].trim();
        if (nombreMatch) result.nombre = nombreMatch[1].trim();
        break;
      }
    } catch(e) {
      console.warn('[OT QR] No se pudieron extraer datos del cliente (empresa):', e);
    }
    return result;
  }

  // ─────────────────────────────────────────────
  // 5. CONSTRUIR VALOR DEL QR
  // Formato: 39885-04-2026|NIT|NOMBRE|EMAIL
  // Los campos de cliente se omiten si no se encuentran, priorizando NIT
  // (llave corta y estable) sobre nombre/correo para no inflar el QR.
  // Sigue siendo compatible con lectores de QR viejos (39885-04-2026|EMAIL).
  // ─────────────────────────────────────────────
  function buildQRValue(orderId, dateInfo, clienteEmpresa, contacto) {
    const base = dateInfo
      ? `${orderId}-${dateInfo.mesNum}-${dateInfo.anio}`
      : orderId;

    const nit    = clienteEmpresa.nit || '';
    const nombre = clienteEmpresa.nombre || '';
    const correo = contacto.email || '';

    const parts = [base];
    if (nit && nombre && correo)      parts.push(nit, nombre, correo);
    else if (nit && correo)           parts.push(nit, correo);
    else if (nit && nombre)           parts.push(nit, nombre, '');
    else if (nit)                     parts.push(nit);
    else if (correo)                  parts.push(correo); // formato antiguo, sin NIT

    const value = parts.join('|');
    console.log(`[OT QR] Valor codificado: ${value}`);
    return value;
  }

  // ─────────────────────────────────────────────
  // 6. ESTILOS
  // ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ot-qr-styles')) return;
    const s = document.createElement('style');
    s.id = 'ot-qr-styles';
    s.textContent = `
      #${CONFIG.containerId} {
        position      : fixed;
        top           : 12px;
        right         : 16px;
        z-index       : 9999;
        background    : #ffffff;
        border        : 1px solid #cccccc;
        border-radius : 8px;
        padding       : 8px 10px;
        box-shadow    : 0 2px 8px rgba(0,0,0,0.15);
        display       : flex;
        flex-direction: column;
        align-items   : center;
        gap           : 5px;
        font-family   : Arial, sans-serif;
        width         : 130px;
      }
      #${CONFIG.containerId} .ot-label {
        font-size     : 11px;
        font-weight   : 600;
        color         : #444;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        text-align    : center;
      }
      #${CONFIG.containerId} canvas {
        width  : ${CONFIG.qrSize}px !important;
        height : ${CONFIG.qrSize}px !important;
        display: block;
      }
      #${CONFIG.containerId} .ot-month {
        font-size  : 11px;
        font-weight: 700;
        color      : #222;
        text-align : center;
      }
      #${CONFIG.containerId} .ot-nit {
        font-size  : 10px;
        font-weight: 500;
        color      : #666;
        text-align : center;
        word-break : break-word;
      }
      #${CONFIG.containerId} .ot-copy-btn {
        width         : 100%;
        font-size     : 10px;
        font-weight   : 600;
        color         : #fff;
        background    : #2b7cd3;
        border        : none;
        border-radius : 5px;
        padding       : 5px 0;
        cursor        : pointer;
        margin-top    : 2px;
      }
      #${CONFIG.containerId} .ot-copy-btn:hover {
        background: #1f5fa3;
      }

      @media print {
        #${CONFIG.containerId} { display: none !important; }

        #ot-qr-print-wrap {
          display          : flex !important;
          flex-direction   : column;
          align-items      : center;
          gap              : 4pt;
          position         : fixed;
          top              : 0;
          right            : 0;
          margin           : 8mm 8mm 0 0;
          background       : #fff;
          border           : 0.5pt solid #aaa;
          border-radius    : 4pt;
          padding          : 5pt 7pt;
          page-break-inside: avoid;
          z-index          : 9999;
          font-family      : Arial, sans-serif;
          width            : 100pt;
        }
        #ot-qr-print-wrap .ot-label {
          font-size     : 7pt;
          font-weight   : 600;
          color         : #444;
          text-transform: uppercase;
          text-align    : center;
        }
        #ot-qr-print-wrap canvas {
          width  : 80pt !important;
          height : 80pt !important;
          display: block;
        }
        #ot-qr-print-wrap .ot-month {
          font-size  : 18pt;
          font-weight: 700;
          color      : #222;
          text-align : center;
        }
        #ot-qr-print-wrap .ot-nit {
          font-size  : 6pt;
          font-weight: 500;
          color      : #666;
          text-align : center;
        }
      }
    `;
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────
  // 6b. COPIAR AL PORTAPAPELES
  // Copia el texto crudo codificado en el QR (mismo formato que ve el
  // lector de QR al escanearlo), no una imagen.
  // ─────────────────────────────────────────────
  function copiarAlPortapapeles(texto, onResultado) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(
        () => onResultado(true),
        () => copiarConFallback(texto, onResultado)
      );
    } else {
      copiarConFallback(texto, onResultado);
    }
  }

  function copiarConFallback(texto, onResultado) {
    try {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      onResultado(ok);
    } catch (e) {
      console.error('[OT QR] No se pudo copiar al portapapeles:', e);
      onResultado(false);
    }
  }

  // ─────────────────────────────────────────────
  // 7. DIBUJAR QR EN CANVAS (sin duplicados)
  // ─────────────────────────────────────────────
  function drawQRToCanvas(targetCanvas, qrValue, size) {
    const tmp = document.createElement('div');
    tmp.style.cssText = 'position:fixed;top:-9999px;left:-9999px;visibility:hidden;';
    document.body.appendChild(tmp);

    new QRCode(tmp, {
      text        : qrValue,
      width       : size,
      height      : size,
      colorDark   : '#000000',
      colorLight  : '#ffffff',
      correctLevel: QRCode.CorrectLevel.L, // Nivel L = más capacidad de datos
    });

    const srcCanvas = tmp.querySelector('canvas');
    if (srcCanvas) {
      targetCanvas.width  = size;
      targetCanvas.height = size;
      targetCanvas.getContext('2d').drawImage(srcCanvas, 0, 0, size, size);
    }
    document.body.removeChild(tmp);
  }

  // ─────────────────────────────────────────────
  // 8. CONSTRUIR DOM
  // ─────────────────────────────────────────────
  function buildContainers(orderId, dateInfo, nit, qrValue) {
    const monthText = dateInfo ? `${dateInfo.mesNombre} ${dateInfo.anio}` : null;

    // ── Pantalla ──
    const wrap = document.createElement('div');
    wrap.id = CONFIG.containerId;

    const label = document.createElement('span');
    label.className = 'ot-label';
    label.textContent = `OT #${orderId}`;

    const canvas = document.createElement('canvas');
    canvas.id    = 'ot-qr-canvas-screen';
    canvas.width = canvas.height = CONFIG.qrSize;

    wrap.appendChild(label);
    wrap.appendChild(canvas);
    if (monthText) {
      const m = document.createElement('span');
      m.className   = 'ot-month';
      m.textContent = monthText;
      wrap.appendChild(m);
    }
    if (nit) {
      const n = document.createElement('span');
      n.className   = 'ot-nit';
      n.textContent = `NIT ${nit}`;
      wrap.appendChild(n);
    }

    const btnCopiar = document.createElement('button');
    btnCopiar.type        = 'button';
    btnCopiar.className   = 'ot-copy-btn';
    btnCopiar.textContent = 'Copiar';
    btnCopiar.addEventListener('click', () => {
      copiarAlPortapapeles(qrValue, (ok) => {
        const original = 'Copiar';
        btnCopiar.textContent = ok ? '✓ Copiado' : 'Error';
        setTimeout(() => { btnCopiar.textContent = original; }, 1500);
      });
    });
    wrap.appendChild(btnCopiar);

    document.body.appendChild(wrap);

    // ── Impresión ──
    const printWrap = document.createElement('div');
    printWrap.id           = 'ot-qr-print-wrap';
    printWrap.style.display = 'none';

    const printLabel = document.createElement('span');
    printLabel.className   = 'ot-label';
    printLabel.textContent = `OT #${orderId}`;

    const printCanvas = document.createElement('canvas');
    printCanvas.id    = 'ot-qr-canvas-print';
    printCanvas.width = printCanvas.height = 85;

    printWrap.appendChild(printLabel);
    printWrap.appendChild(printCanvas);
    if (monthText) {
      const pm = document.createElement('span');
      pm.className   = 'ot-month';
      pm.textContent = monthText;
      printWrap.appendChild(pm);
    }
    if (nit) {
      const pn = document.createElement('span');
      pn.className   = 'ot-nit';
      pn.textContent = `NIT ${nit}`;
      printWrap.appendChild(pn);
    }
    document.body.appendChild(printWrap);

    return { canvas, printCanvas };
  }

  // ─────────────────────────────────────────────
  // 9. CARGAR LIBRERÍA Y RENDERIZAR
  // ─────────────────────────────────────────────
  function loadAndRender(qrValue, canvas, printCanvas) {
    const render = () => {
      drawQRToCanvas(canvas,      qrValue, CONFIG.qrSize);
      drawQRToCanvas(printCanvas, qrValue, 85);
    };
    if (typeof QRCode !== 'undefined') { render(); return; }
    const s = document.createElement('script');
    s.src    = CONFIG.qrCdn;
    s.onload = render;
    s.onerror = () => console.error('[OT QR] No se pudo cargar QRCode.js');
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────
  // 10. INICIO
  // ─────────────────────────────────────────────
  function init() {
    if (document.getElementById(CONFIG.containerId)) return;

    const orderId = getOrderId();
    if (!orderId) return;

    const proceed = (dateInfo) => {
      const clienteEmpresa = getClienteEmpresa();
      const contacto       = getContactoData();
      const qrValue        = buildQRValue(orderId, dateInfo, clienteEmpresa, contacto);
      injectStyles();
      const { canvas, printCanvas } = buildContainers(orderId, dateInfo, clienteEmpresa.nit, qrValue);
      loadAndRender(qrValue, canvas, printCanvas);
    };

    const dateInfo = getCreationDate();
    if (dateInfo) {
      proceed(dateInfo);
    } else {
      setTimeout(() => proceed(getCreationDate()), 1000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();