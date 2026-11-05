// ==UserScript==
// @name         Entrega de Solución SACI - Hanna Colombia
// @namespace    https://regional.hannacolombia.com/
// @version      1.0.0
// @description  En "Entrega de la Solución" de un requerimiento SACI agrega un botón que pide el link de seguimiento de la calibración (https://servicio.tecnico.hannacolombia.com/calibraciones/...) y llena "Observaciones" con el mensaje estándar de entrega con ese link.
// @author       Servicio Técnico Hanna Colombia
// @match        https://regional.hannacolombia.com/saci/item/*/solucion_entrega*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/saci-entrega-solucion.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/saci-entrega-solucion.user.js
// ==/UserScript==

(function () {
  'use strict';

  const PREFIJO_LINK = 'https://servicio.tecnico.hannacolombia.com/calibraciones/';

  // Mensaje que se inserta tal cual (texto plano con el HTML que la intranet
  // renderiza). Lo único que cambia entre requerimientos es el link.
  function armarMensaje(link) {
    return [
      'Muy buen día,',
      '',
      'Te informamos que tu requerimiento ha sido solucionado exitosamente.',
      '',
      'Te invitamos a registrarte con tu correo <strong>Hanna</strong> para seguir tu calibración en el siguiente enlace:',
      '',
      '<p style="margin: 15px 0;">',
      `  <a href="${link}" style="color: #0275d8; font-weight: bold; text-decoration: underline;">`,
      '    → Sigue tu calibración aquí',
      '  </a>',
      '</p>',
      '',
      'Cordialmente,',
    ].join('\n');
  }

  function dispararEventos(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ─────────────────────────────────────────────
  // 1. UBICAR EL CAMPO "Observaciones"
  // No se confirmó su id/name por inspección, así que se busca por la
  // etiqueta visible (mismo criterio que otros scripts de este repo) y, si
  // no aparece, se usa el primer <textarea> de la página.
  // ─────────────────────────────────────────────
  function buscarObservaciones() {
    const etiquetas = document.querySelectorAll('label');
    for (const lbl of etiquetas) {
      if (!/^\s*observaciones\b/i.test(lbl.textContent || '')) continue;
      if (lbl.htmlFor) {
        const porId = document.getElementById(lbl.htmlFor);
        if (porId && porId.tagName === 'TEXTAREA') return porId;
      }
      const grupo = lbl.closest('.form-group') || lbl.parentElement;
      const enGrupo = grupo && grupo.querySelector('textarea');
      if (enGrupo) return enGrupo;
    }
    return document.querySelector('textarea');
  }

  // ─────────────────────────────────────────────
  // 2. VALIDAR EL LINK
  // Debe ser https://servicio.tecnico.hannacolombia.com/calibraciones/<uuid>
  // ─────────────────────────────────────────────
  const REGEX_LINK = /^https:\/\/servicio\.tecnico\.hannacolombia\.com\/calibraciones\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i;

  // Acepta también que peguen solo el código (uuid) y arma el link completo.
  function normalizarLink(texto) {
    const t = (texto || '').trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return PREFIJO_LINK + t;
    return t;
  }

  // ─────────────────────────────────────────────
  // 3. VENTANA PARA PEGAR EL LINK
  // ─────────────────────────────────────────────
  function abrirVentana(campo) {
    if (document.getElementById('hanna-saci-modal')) return;

    const fondo = document.createElement('div');
    fondo.id = 'hanna-saci-modal';
    fondo.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center;';

    const caja = document.createElement('div');
    caja.style.cssText = 'background:#fff;border-radius:6px;padding:20px;width:min(560px,92vw);box-shadow:0 8px 30px rgba(0,0,0,.3);font-family:inherit;';
    caja.innerHTML = `
      <h4 style="margin:0 0 12px;">Cargar solución de calibración</h4>
      <label for="hanna-saci-link" style="display:block;margin-bottom:6px;font-weight:bold;">Link de seguimiento de la calibración</label>
      <input id="hanna-saci-link" type="text" class="form-control" placeholder="${PREFIJO_LINK}xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" style="width:100%;">
      <div id="hanna-saci-error" style="color:#d9534f;margin-top:6px;min-height:18px;font-size:13px;"></div>
      <div style="text-align:right;margin-top:10px;">
        <button type="button" id="hanna-saci-cancelar" class="btn btn-default">Cancelar</button>
        <button type="button" id="hanna-saci-insertar" class="btn btn-primary" style="margin-left:6px;">Insertar</button>
      </div>`;
    fondo.appendChild(caja);
    document.body.appendChild(fondo);

    const input = caja.querySelector('#hanna-saci-link');
    const error = caja.querySelector('#hanna-saci-error');
    const cerrar = () => fondo.remove();

    function insertar() {
      const link = normalizarLink(input.value);
      if (!REGEX_LINK.test(link)) {
        error.textContent = `El link debe tener la forma ${PREFIJO_LINK}<código>`;
        input.focus();
        return;
      }
      if (campo.value.trim() && !window.confirm('El campo Observaciones ya tiene texto. ¿Reemplazarlo?')) return;
      campo.value = armarMensaje(link);
      dispararEventos(campo);
      cerrar();
      campo.focus();
    }

    caja.querySelector('#hanna-saci-cancelar').addEventListener('click', cerrar);
    caja.querySelector('#hanna-saci-insertar').addEventListener('click', insertar);
    fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); insertar(); }
      if (e.key === 'Escape') cerrar();
    });
    input.focus();
  }

  // ─────────────────────────────────────────────
  // 4. BOTÓN JUNTO A "Observaciones"
  // ─────────────────────────────────────────────
  function init() {
    const campo = buscarObservaciones();
    if (!campo || document.getElementById('hanna-saci-boton')) return;

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.id = 'hanna-saci-boton';
    boton.className = 'btn btn-success btn-sm';
    boton.textContent = '✅ Cargar solución de calibración';
    boton.style.cssText = 'margin:0 0 8px;';
    boton.addEventListener('click', () => abrirVentana(campo));

    campo.parentNode.insertBefore(boton, campo);
  }

  init();
})();
