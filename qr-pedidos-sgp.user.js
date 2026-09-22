// ==UserScript==
// @name         QR Pedidos SGP - Hanna Colombia
// @namespace    https://intranet.hannacolombia.com/
// @version      2.1.0
// @description  QR (SVG vectorial) con RUT, Cotización, Orden de Compra, OTST, Remisión y Factura. Solo se genera si hay Remisión o Factura. Botones de descarga en SVG y PNG.
// @author       Servicio Técnico Hanna Colombia
// @match        https://intranet.hannacolombia.com/sgp/item/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/qr-pedidos-sgp.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/qr-pedidos-sgp.user.js
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    containerId: 'sgp-qr-container',
    // qrcode-generator (kazuhikoarase): genera SVG vectorial real, a
    // diferencia de QRCode.js (davidshimjs) que solo dibuja en <canvas>.
    qrCdn      : 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
    qrCellSize : 6,   // tamaño de cada módulo del QR en pantalla (px)
    qrMargin   : 2,   // margen en módulos
    pngExportSize: 512, // resolución del PNG exportado (px)
  };

  // Etiquetas tal como aparecen en la página (label -> key interno)
  const CAMPOS = {
    'RUT'             : 'rut',
    'Cotización'      : 'cotizacion',
    'Orden de Compra' : 'ordenCompra',
    'OTST'            : 'otst',
    'Remisión'        : 'remision',
    'Factura'         : 'factura',
  };

  // ─────────────────────────────────────────────
  // 1. ID DEL PEDIDO DESDE LA URL
  // ─────────────────────────────────────────────
  function getOrderId() {
    const segs = window.location.pathname.split('/').filter(Boolean);
    const i = segs.indexOf('item');
    const id = i !== -1 ? segs[i + 1] : null;
    return (id && /^[a-zA-Z0-9\-_]+$/.test(id)) ? id : null;
  }

  // ─────────────────────────────────────────────
  // 2. EXTRAER VALOR DE UN CAMPO POR SU ETIQUETA
  // Busca un elemento cuyo texto propio coincida con la etiqueta
  // (p.ej. "RUT:") y toma el valor de la celda / elemento contiguo.
  // Usa 3 estrategias en cascada para adaptarse a distintas estructuras
  // HTML, igual que el script original con "Contacto" / "Cliente".
  // ─────────────────────────────────────────────
  function getFieldValue(label) {
    try {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const labelRe = new RegExp('^' + escaped + ':?\\s*$', 'i');

      // Estrategia A: filas de tabla <tr><td>Etiqueta</td><td>Valor</td></tr>
      const rows = document.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td, th');
        if (cells.length >= 2) {
          const cellText = cells[0].textContent.replace(/\s+/g, ' ').trim();
          if (labelRe.test(cellText)) {
            const val = cells[1].textContent.replace(/\s+/g, ' ').trim();
            return val && val !== '-' ? val : null;
          }
        }
      }

      // Estrategia B: elemento "etiqueta" con hermano contiguo "valor"
      const all = document.querySelectorAll('div, span, td, th, li, strong, b');
      for (const el of all) {
        const own = el.textContent.replace(/\s+/g, ' ').trim();
        if (!labelRe.test(own)) continue;

        const sib = el.nextElementSibling;
        if (sib) {
          const val = sib.textContent.replace(/\s+/g, ' ').trim();
          if (val && val !== '-') return val;
        }

        // Estrategia C: "Etiqueta: valor" dentro del mismo bloque padre
        const parentText = el.parentElement
          ? el.parentElement.textContent.replace(/\s+/g, ' ').trim()
          : '';
        const m = parentText.match(new RegExp(escaped + ':?\\s*([^\\s].*)$', 'i'));
        if (m && m[1]) {
          const val = m[1].trim();
          if (val && val !== '-') return val;
        }
      }
    } catch (e) {
      console.warn(`[SGP QR] No se pudo extraer el campo "${label}":`, e);
    }
    return null;
  }

  function getAllFields() {
    const data = {};
    for (const [label, key] of Object.entries(CAMPOS)) {
      data[key] = getFieldValue(label);
    }
    return data;
  }

  // ─────────────────────────────────────────────
  // 3. CONSTRUIR VALOR DEL QR
  // Formato: ID|RUT|COTIZACION|ORDEN_COMPRA|OTST|REMISION|FACTURA
  // Solo se genera si hay Remisión o Factura (ver init()).
  // ─────────────────────────────────────────────
  function buildQRValue(orderId, data) {
    const parts = [
      orderId,
      data.rut || '',
      data.cotizacion || '',
      data.ordenCompra || '',
      data.otst || '',
      data.remision || '',
      data.factura || '',
    ];
    const value = parts.join('|');
    console.log(`[SGP QR] Valor codificado: ${value}`);
    return value;
  }

  // ─────────────────────────────────────────────
  // 4. ESTILOS
  // ─────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('sgp-qr-styles')) return;
    const s = document.createElement('style');
    s.id = 'sgp-qr-styles';
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
        width         : 140px;
      }
      #${CONFIG.containerId} .sgp-label {
        font-size     : 11px;
        font-weight   : 600;
        color         : #444;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        text-align    : center;
      }
      #${CONFIG.containerId} .sgp-svg-wrap {
        width  : 130px;
        height : 130px;
        display: flex;
        align-items    : center;
        justify-content: center;
      }
      #${CONFIG.containerId} .sgp-svg-wrap svg {
        width : 100%;
        height: 100%;
        display: block;
      }
      #${CONFIG.containerId} .sgp-info {
        font-size  : 10px;
        font-weight: 500;
        color      : #666;
        text-align : center;
        word-break : break-word;
      }
      #${CONFIG.containerId} .sgp-download-row {
        display: flex;
        gap    : 4px;
        width  : 100%;
      }
      #${CONFIG.containerId} .sgp-download-btn {
        flex          : 1;
        font-size     : 10px;
        font-weight   : 600;
        color         : #fff;
        background    : #2b7cd3;
        border        : none;
        border-radius : 5px;
        padding       : 5px 0;
        cursor        : pointer;
      }
      #${CONFIG.containerId} .sgp-download-btn:hover {
        background: #1f5fa3;
      }

      @media print {
        #${CONFIG.containerId} { display: none !important; }
      }
    `;
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────
  // 5. GENERAR EL QR (qrcode-generator) → devuelve el objeto qr ya calculado
  // Prueba typeNumber 0 (auto) y, si falla, busca el tamaño mínimo que
  // alcance a contener el texto.
  // ─────────────────────────────────────────────
  function makeQR(data) {
    let qr = null;
    try {
      qr = qrcode(0, 'L');
      qr.addData(data);
      qr.make();
      return qr;
    } catch (e) {
      for (let t = 1; t <= 40; t++) {
        try {
          qr = qrcode(t, 'L');
          qr.addData(data);
          qr.make();
          return qr;
        } catch (e2) { /* probar el siguiente tamaño */ }
      }
    }
    console.error('[SGP QR] No se pudo generar el código QR.');
    return null;
  }

  // ─────────────────────────────────────────────
  // 6. DESCARGAS
  // ─────────────────────────────────────────────
  function downloadBlob(blob, filename) {
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function downloadSvg(svgEl, filename) {
    const serialized = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([serialized], { type: 'image/svg+xml' });
    downloadBlob(blob, filename);
  }

  function downloadPng(svgEl, filename, size) {
    const serialized = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, filename);
      }, 'image/png');
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      console.error('[SGP QR] No se pudo convertir el SVG a PNG:', e);
    };
    img.src = url;
  }

  // ─────────────────────────────────────────────
  // 7. CONSTRUIR DOM
  // ─────────────────────────────────────────────
  function buildContainer(orderId, data, qr) {
    const wrap = document.createElement('div');
    wrap.id = CONFIG.containerId;

    const label = document.createElement('span');
    label.className = 'sgp-label';
    label.textContent = `Pedido #${orderId}`;
    wrap.appendChild(label);

    const svgWrap = document.createElement('div');
    svgWrap.className = 'sgp-svg-wrap';
    // createSvgTag genera el QR como paths SVG reales (vectorial), no un
    // canvas ni una imagen rasterizada.
    svgWrap.innerHTML = qr.createSvgTag({
      cellSize: CONFIG.qrCellSize,
      margin  : CONFIG.qrMargin,
      scalable: true,
    });
    wrap.appendChild(svgWrap);
    const svgEl = svgWrap.querySelector('svg');

    // Info visible: Remisión y/o Factura (los datos "ancla" del QR)
    const infoParts = [];
    if (data.remision) infoParts.push(`Rem. ${data.remision}`);
    if (data.factura)  infoParts.push(`Fact. ${data.factura}`);
    if (infoParts.length) {
      const info = document.createElement('span');
      info.className   = 'sgp-info';
      info.textContent = infoParts.join(' · ');
      wrap.appendChild(info);
    }

    const row = document.createElement('div');
    row.className = 'sgp-download-row';

    const btnSvg = document.createElement('button');
    btnSvg.type        = 'button';
    btnSvg.className   = 'sgp-download-btn';
    btnSvg.textContent = 'SVG';
    btnSvg.addEventListener('click', () => {
      downloadSvg(svgEl, `QR-pedido-${orderId}.svg`);
    });

    const btnPng = document.createElement('button');
    btnPng.type        = 'button';
    btnPng.className   = 'sgp-download-btn';
    btnPng.textContent = 'PNG';
    btnPng.addEventListener('click', () => {
      downloadPng(svgEl, `QR-pedido-${orderId}.png`, CONFIG.pngExportSize);
    });

    row.appendChild(btnSvg);
    row.appendChild(btnPng);
    wrap.appendChild(row);

    document.body.appendChild(wrap);
  }

  // ─────────────────────────────────────────────
  // 8. CARGAR LIBRERÍA Y RENDERIZAR
  // ─────────────────────────────────────────────
  function loadAndRender(orderId, data, qrValue) {
    const render = () => {
      const qr = makeQR(qrValue);
      if (!qr) return;
      injectStyles();
      buildContainer(orderId, data, qr);
    };
    if (typeof qrcode !== 'undefined') { render(); return; }
    const s = document.createElement('script');
    s.src     = CONFIG.qrCdn;
    s.onload  = render;
    s.onerror = () => console.error('[SGP QR] No se pudo cargar qrcode-generator.');
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────
  // 9. INICIO
  // ─────────────────────────────────────────────
  function init() {
    if (document.getElementById(CONFIG.containerId)) return;

    const orderId = getOrderId();
    if (!orderId) return;

    const proceed = () => {
      const data = getAllFields();

      // Regla: solo se genera el QR si hay Remisión o Factura
      if (!data.remision && !data.factura) {
        console.log('[SGP QR] No se genera QR: falta Remisión y Factura.');
        return;
      }

      const qrValue = buildQRValue(orderId, data);
      loadAndRender(orderId, data, qrValue);
    };

    // Si los datos aún no están en el DOM al cargar, reintenta una vez
    // tras un breve retraso (igual que el script original).
    const dataNow = getAllFields();
    if (dataNow.remision || dataNow.factura) {
      proceed();
    } else {
      setTimeout(proceed, 1000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
