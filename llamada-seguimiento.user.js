// ==UserScript==
// @name         Llamada de Seguimiento Diagnóstico - Hanna Colombia
// @namespace    https://intranet.hannacolombia.com/
// @version      1.4.0
// @description  En "Llamada de Seguimiento Diagnóstico" (OTST): deja por defecto "Contactar nuevamente, no fue posible establecer contacto", sugiere la fecha de próximo contacto (el primer día hábil con cupo según el Planificador de Llamadas; si no hay plan, hoy + 2 días hábiles) y muestra un calendario siempre abierto con atajos, festivos de Colombia y la carga de seguimientos de cada día. Si eliges "contacto efectivo" y das Continuar, pide confirmar que se cerrará la comunicación con la persona. Incluye mensajes rápidos guardables para la observación y llamada agrupada por cliente (encabezado "Orden relacionada con la OTST…"; las demás OTST del cliente se rellenan solas). Nunca presiona Continuar por ti.
// @author       Servicio Técnico Hanna Colombia
// @match        https://intranet.hannacolombia.com/stecnico/item/*/diagnosiscall*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/llamada-seguimiento.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/llamada-seguimiento.user.js
// ==/UserScript==

(function () {
  'use strict';

  const DIAS_SUGERIDOS = 2; // sin plan: fecha sugerida = hoy + N días hábiles
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DIAS = ['Lu','Ma','Mi','Ju','Vi','Sá','Do'];

  // Compartido con planificador-llamadas.user.js (mismo localStorage de la intranet)
  const CLAVE_PLAN = 'hanna_plan_llamadas';
  const CLAVE_LOG = 'hanna_llamadas_log';

  // ─────────────────────────────────────────────
  // Utilidades
  // ─────────────────────────────────────────────
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const pad = (n) => String(n).padStart(2, '0');
  const clave = (f) => `${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}`;
  const leerJSON = (k, def) => { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } };
  const guardarJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  function disparar(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Festivos de Colombia (Ley Emiliani) ──
  function pascua(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const x = h + l - 7 * m + 114;
    return new Date(y, Math.floor(x / 31) - 1, (x % 31) + 1);
  }

  const cacheFestivos = {};
  function festivos(y) {
    if (cacheFestivos[y]) return cacheFestivos[y];
    const s = new Set();
    const add = (f) => s.add(clave(f));
    const alLunes = (f) => { const r = new Date(f); while (r.getDay() !== 1) r.setDate(r.getDate() + 1); return r; };
    [[0, 1], [4, 1], [6, 20], [7, 7], [11, 8], [11, 25]].forEach(([m, d]) => add(new Date(y, m, d)));
    [[0, 6], [2, 19], [5, 29], [7, 15], [9, 12], [10, 1], [10, 11]].forEach(([m, d]) => add(alLunes(new Date(y, m, d))));
    const p = pascua(y);
    [-3, -2, 43, 64, 71].forEach((n) => { const r = new Date(p); r.setDate(r.getDate() + n); add(r); });
    return (cacheFestivos[y] = s);
  }

  function esFinDeSemana(f) { const d = f.getDay(); return d === 0 || d === 6; }
  const esFestivo = (f) => festivos(f.getFullYear()).has(clave(f));
  const esHabil = (f) => !esFinDeSemana(f) && !esFestivo(f);

  function sumarDiasHabiles(base, n) {
    const r = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    let s = 0;
    while (s < n) { r.setDate(r.getDate() + 1); if (esHabil(r)) s++; }
    return r;
  }

  function sumarDias(base, n) {
    const r = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    r.setDate(r.getDate() + n);
    return r;
  }

  // Si cae en fin de semana o festivo, pasa al siguiente día hábil
  function ajustarHabil(f) {
    const r = new Date(f.getFullYear(), f.getMonth(), f.getDate());
    while (!esHabil(r)) r.setDate(r.getDate() + 1);
    return r;
  }

  // El sitio usa DD/MM/AAAA
  function formatear(f) {
    return `${String(f.getDate()).padStart(2, '0')}/${String(f.getMonth() + 1).padStart(2, '0')}/${f.getFullYear()}`;
  }

  function parsear(txt) {
    const m = (txt || '').trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (!m) return null;
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    return d.getMonth() === +m[2] - 1 ? d : null;
  }

  const deClave = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d); };
  const mismoDia = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  // ─────────────────────────────────────────────
  // Plan de llamadas (lo escribe el Planificador al abrir el Libro de Trabajo)
  // ─────────────────────────────────────────────
  function leerPlan() {
    const p = leerJSON(CLAVE_PLAN, null);
    if (!p || !p.carga || !p.cupoSeg) return null;
    // Un plan de hace más de 5 días ya no refleja la realidad
    if (Date.now() - new Date(p.generado).getTime() > 5 * 864e5) return null;
    return p;
  }

  const cargaDe = (plan, f) => (plan ? plan.carga[clave(f)] || 0 : 0);

  // Primer día hábil después de hoy con cupo de seguimiento libre
  function fechaSugerida(plan) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    if (!plan) return sumarDiasHabiles(hoy, DIAS_SUGERIDOS);
    let f = sumarDiasHabiles(hoy, 1);
    for (let i = 0; i < 120 && cargaDe(plan, f) >= plan.cupoSeg; i++) f = sumarDiasHabiles(f, 1);
    return f;
  }

  // ─────────────────────────────────────────────
  // Ubicar elementos por su texto visible (no por nombres internos)
  // ─────────────────────────────────────────────
  function selectAccion() {
    for (const s of document.querySelectorAll('select')) {
      if ([...s.options].some((o) => /contactar nuevamente/i.test(o.text))) return s;
    }
    return null;
  }

  function opcion(select, regex) {
    return [...select.options].find((o) => regex.test(o.text)) || null;
  }

  // Primer <input> de texto que aparece DESPUÉS de una etiqueta con ese texto
  function inputTrasEtiqueta(texto) {
    const t = norm(texto);
    const etiquetas = [...document.querySelectorAll('label, b, strong, span, div, td, th')].filter(
      (el) => el.children.length <= 2 && norm(el.textContent).replace(/[:*\s]+$/, '').startsWith(t) && norm(el.textContent).length < t.length + 8
    );
    for (const et of etiquetas) {
      for (const inp of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio])')) {
        if (et.compareDocumentPosition(inp) & Node.DOCUMENT_POSITION_FOLLOWING) return inp;
      }
    }
    return null;
  }

  function botonContinuar() {
    for (const b of document.querySelectorAll('button, input[type=submit], input[type=button], a.button')) {
      if (/^continuar$/i.test((b.value || b.textContent || '').trim())) return b;
    }
    return null;
  }

  // ─────────────────────────────────────────────
  // Estilos
  // ─────────────────────────────────────────────
  function estilos() {
    if (document.getElementById('ot-ls-styles')) return;
    const s = document.createElement('style');
    s.id = 'ot-ls-styles';
    s.textContent = `
      /* El calendario nativo se reemplaza por el panel de este script */
      #ui-datepicker-div { display: none !important; }
      #ot-ls-fila { display: flex; align-items: flex-start; gap: 18px; }
      #ot-ls-fila > .ot-ls-bloque { flex: 1 1 auto; min-width: 0; }
      #ot-ls-fila > #ot-ls-cal { flex: 0 0 296px; }
      #ot-ls-fila textarea { min-height: 190px; box-sizing: border-box; }
      #ot-ls-cal { margin: 0 0 14px; padding: 8px 10px; width: 296px; box-sizing: border-box; background: #fff;
        border: 1px solid #cfd8e3; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,40,90,.12); font-family: Arial, sans-serif; }
      #ot-ls-cal .ls-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
      #ot-ls-cal .ls-titulo { font-weight: 700; color: #0b3d78; font-size: 13px; }
      #ot-ls-cal .ls-nav { border: 0; background: #eef3f9; color: #0b3d78; width: 22px; height: 22px; border-radius: 50%; cursor: pointer; font-size: 13px; line-height: 1; }
      #ot-ls-cal .ls-nav:hover { background: #d8e6f5; }
      #ot-ls-cal .ls-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
      #ot-ls-cal .ls-dow { text-align: center; font-size: 10px; font-weight: 700; color: #6b7a8c; padding: 1px 0; }
      #ot-ls-cal .ls-dia { border: 0; background: #f6f8fb; border-radius: 6px; height: 19px; line-height: 1; padding: 0; font-size: 11px; color: #1f2d3d; cursor: pointer; }
      #ot-ls-cal .ls-dia:hover { background: #d8e6f5; }
      #ot-ls-cal .ls-dia.finde { color: #a5b0bd; background: #fafbfc; }
      #ot-ls-cal .ls-dia.festivo { color: #c0392b; background: #fafbfc; text-decoration: line-through; }
      #ot-ls-cal .ls-dia.libre { background: #e3f4e8; }
      #ot-ls-cal .ls-dia.medio { background: #fff1c2; }
      #ot-ls-cal .ls-dia.lleno { background: #f8d0cc; color: #8c1d12; }
      #ot-ls-cal .ls-dia.hoy { outline: 2px solid #f0c040; outline-offset: -2px; }
      #ot-ls-cal .ls-dia.pasado { opacity: .35; cursor: not-allowed; background: #f6f8fb; color: #1f2d3d; }
      #ot-ls-cal .ls-dia.sel { background: #0b6fd6; color: #fff; font-weight: 700; }
      #ot-ls-cal .ls-vacio { visibility: hidden; }
      #ot-ls-cal .ls-atajos { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 6px; }
      #ot-ls-cal .ls-atajo { border: 1px solid #b7cbe3; background: #fff; color: #0b3d78; border-radius: 12px; padding: 2px 6px; font-size: 10.5px; cursor: pointer; white-space: nowrap; }
      #ot-ls-cal .ls-atajo:hover { background: #eaf2fb; }
      #ot-ls-cal .ls-atajo.sug { background: #e3f4e8; border-color: #8fc9a1; color: #1e6b3a; font-weight: 700; }
      #ot-ls-cal .ls-resumen { font-size: 11px; color: #6b7a8c; margin-top: 6px; line-height: 1.35; }
      #ot-ls-cal .ls-resumen.alerta { color: #c0392b; font-weight: 700; }
      #ot-ls-msgs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 2px 0 8px; font-family: Arial, sans-serif; }
      #ot-ls-msgs .ls-tit { font-size: 12px; color: #6b7a8c; margin-right: 2px; }
      #ot-ls-msgs .ls-chip { display: inline-flex; align-items: center; border: 1px solid #b7cbe3; background: #f3f8fd; border-radius: 14px; overflow: hidden; }
      #ot-ls-msgs .ls-chip button { border: 0; background: transparent; cursor: pointer; font-size: 12px; color: #0b3d78; padding: 5px 10px; max-width: 360px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #ot-ls-msgs .ls-chip button:hover { background: #dcebfa; }
      #ot-ls-msgs .ls-chip .ls-x { padding: 5px 8px 5px 4px; color: #8a97a6; }
      #ot-ls-msgs .ls-chip .ls-x:hover { color: #c0392b; background: transparent; }
      #ot-ls-msgs .ls-guardar { border: 1px dashed #8fb0d6; background: #fff; color: #0b3d78; border-radius: 14px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
      #ot-ls-msgs .ls-guardar:hover { background: #eaf2fb; }
      #ot-ls-grupo { margin: 4px 0 10px; padding: 9px 12px; border: 1px solid #c9b8ea; border-left: 4px solid #6b3fb5; border-radius: 8px; background: #f8f4ff; font-family: Arial, sans-serif; font-size: 12.5px; color: #1f2d3d; }
      #ot-ls-grupo .lg-tit { font-weight: 700; color: #4a2a85; margin-bottom: 5px; }
      #ot-ls-grupo .lg-estado { margin-bottom: 6px; }
      #ot-ls-grupo .lg-otsts { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 7px; }
      #ot-ls-grupo label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }
      #ot-ls-grupo label small { color: #6b7a8c; }
      #ot-ls-grupo label.lg-seg { font-weight: 700; color: #4a2a85; }
      #ot-ls-grupo .lg-acciones { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
      #ot-ls-grupo button { border: 1px solid #6b3fb5; background: #6b3fb5; color: #fff; border-radius: 14px; padding: 4px 12px; font-size: 12px; cursor: pointer; font-weight: 700; }
      #ot-ls-grupo button:hover { background: #57319a; }
      #ot-ls-grupo .lg-nota { color: #6b7a8c; font-size: 11.5px; }
      #ot-ls-grupo .lg-ok { color: #2f855a; font-weight: 700; }
      #ot-ls-overlay { position: fixed; inset: 0; background: rgba(15,25,40,.55); z-index: 2147483000; display: flex; align-items: center; justify-content: center; }
      #ot-ls-modal { background: #fff; border-radius: 12px; padding: 24px 26px; max-width: 420px; width: calc(100% - 32px);
        box-shadow: 0 10px 40px rgba(0,0,0,.35); font-family: Arial, sans-serif; }
      #ot-ls-modal h3 { margin: 0 0 10px; font-size: 18px; color: #0b3d78; }
      #ot-ls-modal p { margin: 0 0 18px; font-size: 15px; color: #1f2d3d; line-height: 1.45; }
      #ot-ls-modal .ls-btns { display: flex; justify-content: flex-end; gap: 10px; }
      #ot-ls-modal button { border-radius: 8px; padding: 9px 16px; font-size: 14px; cursor: pointer; border: 1px solid #b7cbe3; background: #fff; color: #0b3d78; }
      #ot-ls-modal button.ls-ok { background: #0b6fd6; border-color: #0b6fd6; color: #fff; font-weight: 700; }
    `;
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────
  // Calendario propio
  // ─────────────────────────────────────────────
  let estado = { vista: null, input: null };

  function actualizarInput(input, fecha) {
    input.value = formatear(fecha);
    disparar(input);
    // Si el sitio usa datepicker de jQuery UI, también se lo informamos
    try {
      const $ = window.jQuery;
      if ($ && $.fn && $.fn.datepicker && $(input).data('datepicker')) $(input).datepicker('setDate', input.value);
    } catch (e) { /* no crítico */ }
    dibujar();
  }

  function dibujar() {
    const cal = document.getElementById('ot-ls-cal');
    if (!cal || !estado.input) return;
    const input = estado.input;
    const sel = parsear(input.value);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const plan = leerPlan();
    if (!estado.vista) estado.vista = new Date((sel || hoy).getFullYear(), (sel || hoy).getMonth(), 1);
    const v = estado.vista;

    cal.innerHTML = '';
    const head = document.createElement('div'); head.className = 'ls-head';
    const mk = (txt, fn, cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = txt; b.addEventListener('click', fn); return b; };
    const titulo = document.createElement('span'); titulo.className = 'ls-titulo'; titulo.textContent = `${MESES[v.getMonth()]} ${v.getFullYear()}`;
    head.append(
      mk('‹', () => { estado.vista = new Date(v.getFullYear(), v.getMonth() - 1, 1); dibujar(); }, 'ls-nav'),
      titulo,
      mk('›', () => { estado.vista = new Date(v.getFullYear(), v.getMonth() + 1, 1); dibujar(); }, 'ls-nav')
    );
    cal.appendChild(head);

    const grid = document.createElement('div'); grid.className = 'ls-grid';
    DIAS.forEach((d) => { const e = document.createElement('div'); e.className = 'ls-dow'; e.textContent = d; grid.appendChild(e); });
    const offset = (new Date(v.getFullYear(), v.getMonth(), 1).getDay() + 6) % 7; // semana inicia lunes
    for (let i = 0; i < offset; i++) { const e = document.createElement('span'); e.className = 'ls-vacio'; grid.appendChild(e); }
    const total = new Date(v.getFullYear(), v.getMonth() + 1, 0).getDate();
    for (let d = 1; d <= total; d++) {
      const f = new Date(v.getFullYear(), v.getMonth(), d);
      const b = document.createElement('button'); b.type = 'button';
      let carga = '';
      if (esFestivo(f) && !esFinDeSemana(f)) { carga = ' festivo'; b.title = 'Festivo'; }
      else if (plan && f > hoy && esHabil(f)) {
        const n = cargaDe(plan, f);
        carga = n >= plan.cupoSeg ? ' lleno' : n >= plan.cupoSeg * 0.7 ? ' medio' : ' libre';
        b.title = `${n}/${plan.cupoSeg} seguimientos planeados`;
      }
      b.className = 'ls-dia' + (esFinDeSemana(f) ? ' finde' : '') + carga + (mismoDia(f, hoy) ? ' hoy' : '') + (f < hoy ? ' pasado' : '') + (mismoDia(f, sel) ? ' sel' : '');
      b.textContent = d;
      if (f >= hoy) b.addEventListener('click', () => actualizarInput(input, f));
      grid.appendChild(b);
    }
    cal.appendChild(grid);

    const atajos = document.createElement('div'); atajos.className = 'ls-atajos';
    const lista = [['Mañana', () => sumarDiasHabiles(hoy, 1)], ['2 días háb.', () => sumarDiasHabiles(hoy, 2)],
      ['1 semana', () => ajustarHabil(sumarDias(hoy, 7))], ['2 semanas', () => ajustarHabil(sumarDias(hoy, 14))]];
    if (plan) { const s = fechaSugerida(plan); lista.unshift([`Sugerida ${pad(s.getDate())}/${pad(s.getMonth() + 1)}`, () => s, 'sug']); }
    lista.forEach(([txt, fn, cls]) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ls-atajo' + (cls ? ' ' + cls : ''); b.textContent = txt;
      if (cls === 'sug') b.title = 'Primer día hábil con cupo de seguimiento libre';
      b.addEventListener('click', () => { const f = fn(); estado.vista = new Date(f.getFullYear(), f.getMonth(), 1); actualizarInput(input, f); });
      atajos.appendChild(b);
    });
    cal.appendChild(atajos);

    const res = document.createElement('div'); res.className = 'ls-resumen';
    if (!sel) res.textContent = 'Elige una fecha';
    else if (!esHabil(sel)) { res.className += ' alerta'; res.textContent = `⚠ ${formatear(sel)} no es día hábil${esFestivo(sel) ? ' (festivo)' : ''}.`; }
    else if (plan && cargaDe(plan, sel) >= plan.cupoSeg) {
      res.className += ' alerta';
      res.textContent = `⚠ El ${formatear(sel)} ya tiene ${cargaDe(plan, sel)}/${plan.cupoSeg} seguimientos. Sugerida: ${formatear(fechaSugerida(plan))}.`;
    } else if (plan) res.textContent = `${formatear(sel)}: ${cargaDe(plan, sel)}/${plan.cupoSeg} seguimientos planeados. Verde = con cupo, amarillo = casi lleno, rojo = lleno.`;
    else res.textContent = 'Abre el Libro de Trabajo (con el Planificador de Llamadas instalado) para ver la carga de cada día.';
    cal.appendChild(res);
  }

  function visible(el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); }

  // Calendario AL LADO del cuadro de Observación (a su derecha). Si no se
  // encuentra el cuadro, queda debajo del campo de fecha.
  function ubicarCalendario(cal, input, select) {
    const area = (select.form || document).querySelector('textarea');
    if (!area) {
      if (cal.previousElementSibling !== input) input.insertAdjacentElement('afterend', cal);
      return;
    }
    let fila = document.getElementById('ot-ls-fila');
    if (!fila) {
      // Se envuelve el bloque completo del textarea (incluida su barra de redimensionar)
      const bloque = area.closest('.resizable-textarea, .form-textarea-wrapper') || area.parentElement;
      fila = document.createElement('div'); fila.id = 'ot-ls-fila';
      bloque.parentNode.insertBefore(fila, bloque);
      fila.appendChild(bloque);
      bloque.classList.add('ot-ls-bloque');
    }
    if (cal.parentNode !== fila) fila.appendChild(cal);
  }

  function asegurarCalendario(select) {
    const input = inputTrasEtiqueta('Fecha para Próximo Contacto');
    const existente = document.getElementById('ot-ls-cal');
    const mostrar = input && visible(input) && /contactar nuevamente/i.test(select.options[select.selectedIndex]?.text || '');
    if (!mostrar) { if (existente && existente.style.display !== 'none') existente.style.display = 'none'; return; }

    estado.input = input;
    // Fecha sugerida solo si está vacía (nunca pisa lo ya elegido)
    if (!input.value.trim() && !input.dataset.lsSugerida) {
      input.dataset.lsSugerida = '1';
      input.value = formatear(fechaSugerida(leerPlan()));
      disparar(input);
    }
    let cal = existente;
    if (!cal) {
      cal = document.createElement('div'); cal.id = 'ot-ls-cal';
      input.addEventListener('input', () => { estado.vista = null; dibujar(); });
      input.addEventListener('change', () => { estado.vista = null; dibujar(); });
    }
    ubicarCalendario(cal, input, select);
    if (cal.style.display) cal.style.display = '';
    if (!cal.dataset.dibujado || input.dataset.lsRefrescar) { cal.dataset.dibujado = '1'; estado.vista = null; dibujar(); }
  }

  // ─────────────────────────────────────────────
  // Mensajes rápidos para el cuadro de Observación
  // Se guardan en este navegador (localStorage del sitio).
  // ─────────────────────────────────────────────
  const CLAVE_MSGS = 'hanna_ls_mensajes';
  const MSGS_INICIALES = ['Cliente no atiende a las llamadas. Se deja mensaje por WhatsApp.'];

  function leerMensajes() {
    try {
      const g = localStorage.getItem(CLAVE_MSGS);
      if (g !== null) { const a = JSON.parse(g); if (Array.isArray(a)) return a.filter((x) => typeof x === 'string' && x.trim()); }
    } catch (e) {}
    return MSGS_INICIALES.slice();
  }

  function guardarMensajes(lista) {
    try { localStorage.setItem(CLAVE_MSGS, JSON.stringify(lista)); } catch (e) {}
  }

  function cargarMensaje(area, texto) {
    const actual = area.value.trim();
    area.value = actual ? `${area.value.replace(/\s+$/, '')} ${texto}` : texto;
    disparar(area);
    area.focus();
  }

  function dibujarMensajes(barra, area) {
    barra.innerHTML = '';
    const tit = document.createElement('span'); tit.className = 'ls-tit'; tit.textContent = 'Mensajes rápidos:';
    barra.appendChild(tit);
    const lista = leerMensajes();
    lista.forEach((txt, i) => {
      const chip = document.createElement('span'); chip.className = 'ls-chip';
      const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.title = txt;
      b.addEventListener('click', () => cargarMensaje(area, txt));
      const x = document.createElement('button'); x.type = 'button'; x.className = 'ls-x'; x.textContent = '×'; x.title = 'Eliminar este mensaje rápido';
      x.addEventListener('click', () => { const l = leerMensajes(); l.splice(i, 1); guardarMensajes(l); dibujarMensajes(barra, area); });
      chip.append(b, x); barra.appendChild(chip);
    });
    const g = document.createElement('button'); g.type = 'button'; g.className = 'ls-guardar'; g.textContent = '+ Guardar el texto actual';
    g.title = 'Guarda lo que hay escrito en Observación como mensaje rápido';
    g.addEventListener('click', () => {
      const txt = area.value.replace(/\s+/g, ' ').trim();
      if (!txt) { g.textContent = 'Escribe primero algo en Observación'; setTimeout(() => dibujarMensajes(barra, area), 1800); return; }
      const l = leerMensajes();
      if (!l.includes(txt)) { l.push(txt); guardarMensajes(l); }
      dibujarMensajes(barra, area);
    });
    barra.appendChild(g);
  }

  function asegurarMensajes(select) {
    const area = (select.form || document).querySelector('textarea');
    if (!area || document.getElementById('ot-ls-msgs')) return;
    const barra = document.createElement('div'); barra.id = 'ot-ls-msgs';
    const ref = document.getElementById('ot-ls-fila') || area.closest('.resizable-textarea, .form-textarea-wrapper') || area.parentElement;
    ref.parentNode.insertBefore(barra, ref);
    dibujarMensajes(barra, area);
  }

  // ─────────────────────────────────────────────
  // Llamada agrupada por cliente
  // Con una sola llamada se atienden todas las OTST del cliente: todas llevan el
  // mismo texto ("Orden relacionada con la OTST x1, …, xn. Se deja seguimiento
  // en xn" + lo que se habló), se cierran con "contacto efectivo" y solo la
  // mayor (xn) se reprograma. El grupo se recuerda durante el día: las demás
  // OTST del grupo se rellenan solas y el Planificador lo cuenta como UNA llamada.
  // ─────────────────────────────────────────────
  const CLAVE_GRUPO = 'hanna_llamada_grupo';
  const CLAVE_FILAS = 'hanna_pl_filas'; // última lectura del Libro de Trabajo (Planificador)
  const RE_ENCABEZADO = /Orden relacionada con las? OTST\s*([\d\s,y.]+?)\s*\.?\s*Se deja (?:el )?seguimiento en (?:la )?(?:OTST\s*)?(\d+)\.?/i;
  const otstActual = () => (location.pathname.match(/item\/(\d+)/) || [])[1] || '';
  const ordenar = (l) => [...new Set(l.map(String))].sort((a, b) => +a - +b);
  const textoEncabezado = (otsts, seg) => `Orden relacionada con la OTST ${otsts.join(', ')}. Se deja seguimiento en ${seg}`;

  function leerEncabezado(texto) {
    const m = (texto || '').match(RE_ENCABEZADO);
    if (!m) return null;
    return { otsts: ordenar((m[1].match(/\d{3,}/g) || []).concat(m[2])), seguimiento: m[2] };
  }

  function grupoGuardado() {
    const g = leerJSON(CLAVE_GRUPO, null);
    return g && g.dia === clave(new Date()) && Array.isArray(g.otsts) ? g : null;
  }

  // OTST del mismo cliente en "Llamada Seguimiento Diagnóstico" (según la última lectura del Planificador)
  function otstsDelCliente(otst) {
    const d = leerJSON(CLAVE_FILAS, null);
    const filas = d && Array.isArray(d.filas) ? d.filas : [];
    const yo = filas.find((f) => String(f.otst) === otst);
    return yo ? { cliente: yo.cliente, filas: filas.filter((f) => f.cliente === yo.cliente) } : null;
  }

  function elegirAccion(select, efectivo) {
    const op = opcion(select, efectivo ? /contacto con el cliente fue efectivo/i : /contactar nuevamente/i);
    if (!op || select.value === op.value) return;
    select.value = op.value;
    try { const $ = window.jQuery; if ($) $(select).trigger('change'); } catch (e) {}
    disparar(select);
  }

  // Pone (o reemplaza) el encabezado como primera línea de la Observación
  function ponerEncabezado(area, texto) {
    const lineas = area.value.split(/\r?\n/);
    const resto = RE_ENCABEZADO.test(lineas[0] || '') ? lineas.slice(1) : lineas;
    area.value = resto.join('').trim() ? [texto, ...resto].join('\n') : texto + '\n';
    disparar(area);
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  }

  // Al abrir otra OTST de un grupo ya iniciado hoy: mismo texto, mismo contacto y la acción que le toca
  function prellenarGrupo(select, area, g, otst) {
    if (!area.value.trim() && g.texto) { area.value = g.texto; disparar(area); }
    const contacto = inputTrasEtiqueta('Nombre Contacto');
    if (contacto && !contacto.value.trim() && g.contacto) { contacto.value = g.contacto; disparar(contacto); }
    const esSeg = otst === g.seguimiento;
    elegirAccion(select, !esSeg);
    if (esSeg && g.fecha) {
      setTimeout(() => {
        const input = inputTrasEtiqueta('Fecha para Próximo Contacto');
        if (!input) return;
        input.dataset.lsSugerida = '1';
        input.value = formatear(deClave(g.fecha));
        disparar(input);
        asegurarCalendario(select);
      }, 200);
    }
  }

  function dibujarGrupo(caja, select, area, cli, g, otst) {
    const hoyK = clave(new Date());
    const registradas = new Set(leerJSON(CLAVE_LOG, []).filter((e) => e && e.ts && clave(new Date(e.ts)) === hoyK).map((e) => String(e.otst)));
    const info = {};
    (cli ? cli.filas : []).forEach((f) => { info[f.otst] = f; });
    const todas = ordenar([...Object.keys(info), ...(g ? g.otsts : []), otst]);
    const marcadas = new Set(g ? g.otsts : todas);
    const cliente = (cli && cli.cliente) || '';

    caja.innerHTML = '';
    const tit = document.createElement('div'); tit.className = 'lg-tit';
    tit.textContent = `🔗 Llamada agrupada${cliente ? ' — ' + cliente : ''}: ${todas.length} OTST`;
    const est = document.createElement('div'); est.className = 'lg-estado';
    const cont = document.createElement('div'); cont.className = 'lg-otsts';
    const checks = todas.map((o) => {
      const l = document.createElement('label');
      const c = document.createElement('input'); c.type = 'checkbox'; c.value = o; c.checked = marcadas.has(o);
      if (o === otst) { c.disabled = true; c.checked = true; }
      const f = info[o];
      const det = registradas.has(o) && o !== otst ? '✅ registrada hoy'
        : !f ? '' : f.fecha ? (f.fecha < hoyK ? 'vencida ' : '') + f.fecha.split('-').reverse().slice(0, 2).join('/') : 'sin contacto';
      const sm = document.createElement('small');
      sm.textContent = o === otst ? `(esta${det ? ', ' + det : ''})` : det ? `(${det})` : '';
      l.append(c, ` ${o} `, sm);
      c.addEventListener('change', pintar);
      cont.appendChild(l);
      return { c, l };
    });
    const acc = document.createElement('div'); acc.className = 'lg-acciones';
    const b = document.createElement('button'); b.type = 'button';
    const nota = document.createElement('span'); nota.className = 'lg-nota';
    acc.append(b, nota);
    caja.append(tit, est, cont, acc);

    function elegidas() { return ordenar(checks.filter((x) => x.c.checked).map((x) => x.c.value)); }
    function pintar() {
      const sel = elegidas();
      const seg = sel[sel.length - 1];
      checks.forEach((x) => x.l.classList.toggle('lg-seg', x.c.value === seg));
      const accion = otst === seg ? 'aquí queda el seguimiento (Contactar nuevamente + fecha)' : 'se cierra con «contacto efectivo»';
      est.textContent = '';
      if (g) {
        const faltan = sel.filter((o) => !(g.hechas || []).includes(o) && o !== otst);
        const ok = document.createElement('span'); ok.className = 'lg-ok';
        ok.textContent = `Grupo iniciado hoy (${(g.hechas || []).length} de ${g.otsts.length} registradas). `;
        est.append(ok, `Esta OTST: ${accion}. ${faltan.length ? 'Después faltan: ' + faltan.join(', ') + '.' : 'Es la última del grupo.'}`);
      } else {
        est.textContent = `¿Con esta llamada atiendes varias? Marca cuáles. El seguimiento queda en la mayor (${seg}); las demás se cierran. Esta OTST: ${accion}.`;
      }
      b.textContent = g ? 'Actualizar encabezado' : 'Insertar encabezado';
      nota.textContent = `«${textoEncabezado(sel, seg)}» — escribe debajo lo que se habló. Al dar Continuar, el texto queda listo para las demás OTST del grupo.`;
    }
    b.addEventListener('click', () => {
      const sel = elegidas();
      const seg = sel[sel.length - 1];
      ponerEncabezado(area, textoEncabezado(sel, seg));
      elegirAccion(select, otst !== seg);
    });
    pintar();
  }

  function asegurarGrupo(select) {
    const area = (select.form || document).querySelector('textarea');
    if (!area || document.getElementById('ot-ls-grupo')) return;
    const otst = otstActual();
    const guardado = grupoGuardado();
    const g = guardado && guardado.otsts.includes(otst) && !(guardado.hechas || []).includes(otst) ? guardado : null;
    const cli = otstsDelCliente(otst);
    if (!g && (!cli || cli.filas.length < 2)) return;
    const caja = document.createElement('div'); caja.id = 'ot-ls-grupo';
    const ref = document.getElementById('ot-ls-msgs') || document.getElementById('ot-ls-fila') || area.closest('.resizable-textarea, .form-textarea-wrapper') || area.parentElement;
    ref.parentNode.insertBefore(caja, ref);
    if (g) prellenarGrupo(select, area, g, otst);
    dibujarGrupo(caja, select, area, cli, g, otst);
  }

  // ─────────────────────────────────────────────
  // Confirmación al cerrar la comunicación
  // ─────────────────────────────────────────────
  let confirmado = false;

  function esEfectivo(select) {
    return /contacto con el cliente fue efectivo/i.test(select.options[select.selectedIndex]?.text || '');
  }

  function modalConfirmar(nombre, alAceptar) {
    const ov = document.createElement('div'); ov.id = 'ot-ls-overlay';
    const m = document.createElement('div'); m.id = 'ot-ls-modal';
    m.innerHTML = '<h3>Cerrar la comunicación</h3><p></p><div class="ls-btns"><button type="button" class="ls-no">Cancelar</button><button type="button" class="ls-ok">Sí, cerrar</button></div>';
    const p = m.querySelector('p');
    p.append('Se cerrará la comunicación con ');
    const b = document.createElement('b'); b.textContent = nombre || 'esta persona'; p.append(b, '. ¿Estás seguro?');
    ov.appendChild(m); document.body.appendChild(ov);
    const cerrar = () => { document.removeEventListener('keydown', tecla, true); ov.remove(); };
    const tecla = (e) => { if (e.key === 'Escape') { e.preventDefault(); cerrar(); } };
    document.addEventListener('keydown', tecla, true);
    m.querySelector('.ls-no').addEventListener('click', cerrar);
    m.querySelector('.ls-ok').addEventListener('click', () => { cerrar(); alAceptar(); });
    ov.addEventListener('click', (e) => { if (e.target === ov) cerrar(); });
    m.querySelector('.ls-ok').focus();
  }

  function proteger(e, select) {
    if (confirmado || !esEfectivo(select)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const campo = inputTrasEtiqueta('Nombre Contacto');
    const nombre = (campo && campo.value.trim()) || '';
    modalConfirmar(nombre, () => {
      confirmado = true;
      const btn = botonContinuar();
      if (btn) btn.click();
      setTimeout(() => { confirmado = false; }, 1500);
    });
  }

  // ─────────────────────────────────────────────
  // Registro de la llamada al enviar el formulario: suma la reprogramación a
  // la carga del día elegido (para que la siguiente sugerencia ya la cuente)
  // y deja una bitácora local para los indicadores del Planificador.
  // ─────────────────────────────────────────────
  let registrado = false;

  function registrarLlamada(e, select) {
    if (registrado || e.defaultPrevented) return;
    registrado = true;
    const otst = otstActual();
    const efectivo = esEfectivo(select);
    const fecha = !efectivo && estado.input ? parsear(estado.input.value) : null;
    const entrada = { otst, ts: new Date().toISOString(), accion: efectivo ? 'efectiva' : 'reprogramada', fecha: fecha ? clave(fecha) : null };
    // Llamada agrupada: la Observación empieza con "Orden relacionada con la OTST…"
    const area = (select.form || document).querySelector('textarea');
    const enc = area ? leerEncabezado(area.value) : null;
    if (enc && enc.otsts.includes(otst)) {
      entrada.grupo = enc.seguimiento;
      entrada.otsts = enc.otsts;
      const prev = grupoGuardado();
      const mismo = prev && prev.seguimiento === enc.seguimiento;
      const contacto = inputTrasEtiqueta('Nombre Contacto');
      guardarJSON(CLAVE_GRUPO, {
        dia: clave(new Date()), seguimiento: enc.seguimiento, otsts: enc.otsts, texto: area.value,
        contacto: contacto && contacto.value.trim() ? contacto.value.trim() : mismo ? prev.contacto || '' : '',
        fecha: fecha && otst === enc.seguimiento ? clave(fecha) : mismo ? prev.fecha || null : null,
        hechas: [...new Set([...(mismo ? prev.hechas || [] : []), otst])],
      });
    }
    const log = leerJSON(CLAVE_LOG, []);
    log.push(entrada);
    guardarJSON(CLAVE_LOG, log.slice(-3000));
    const plan = leerJSON(CLAVE_PLAN, null);
    if (plan && plan.carga && fecha) {
      plan.carga[clave(fecha)] = (plan.carga[clave(fecha)] || 0) + 1;
      plan.sugerida = clave(fechaSugerida(plan));
      guardarJSON(CLAVE_PLAN, plan);
    }
  }

  // ─────────────────────────────────────────────
  // Preparación (idempotente: se repite cuando la página cambia)
  // ─────────────────────────────────────────────
  let primeraVez = true;

  function preparar() {
    const select = selectAccion();
    if (!select) return;
    estilos();

    if (primeraVez) {
      primeraVez = false;
      // Valor por defecto: solo si el usuario aún no eligió nada
      if (!select.value) {
        const op = opcion(select, /contactar nuevamente/i);
        if (op) {
          select.value = op.value;
          try { const $ = window.jQuery; if ($) $(select).trigger('change'); } catch (e) {}
          disparar(select);
        }
      }
      select.addEventListener('change', () => setTimeout(() => asegurarCalendario(select), 60));

      const btn = botonContinuar();
      if (btn) btn.addEventListener('click', (e) => proteger(e, select), true);
      if (select.form) {
        select.form.addEventListener('submit', (e) => proteger(e, select), true);
        // Fase de burbuja: solo registra si nadie canceló el envío
        select.form.addEventListener('submit', (e) => registrarLlamada(e, select));
      }
    }
    asegurarMensajes(select);
    asegurarCalendario(select);
    asegurarGrupo(select);
  }

  preparar();
  let t = null;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(preparar, 150); })
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
})();
