// ==UserScript==
// @name         Planificador de Llamadas de Seguimiento - Hanna Colombia
// @namespace    https://intranet.hannacolombia.com/
// @version      1.1.0
// @description  En el Libro de Trabajo y en la Agenda rápida (/stecnico/agenda-llamadas): arma la lista de llamadas del día respetando el cupo (40 diarias = máx. 10 de seguimiento [vencidas/reprogramadas] + el resto nuevas sin contacto), muestra la carga de los próximos días hábiles (con festivos de Colombia), alertas, envejecimiento y avance del día. La Agenda abre al instante con la última lista guardada y actualiza el Libro de Trabajo en segundo plano. Deja la carga por día en el navegador para que "Llamada de Seguimiento Diagnóstico" sugiera la fecha con cupo. Solo lee la intranet: nunca cambia fechas ni envía formularios.
// @author       Servicio Técnico Hanna Colombia
// @match        https://intranet.hannacolombia.com/stecnico/libro_trabajo*
// @match        https://intranet.hannacolombia.com/stecnico/agenda-llamadas*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/planificador-llamadas.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/planificador-llamadas.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Debe coincidir siempre con @version del header de arriba.
  const VERSION = '1.1.0';
  const URL_AGENDA = '/stecnico/agenda-llamadas';
  const URL_LIBRO = '/stecnico/libro_trabajo';
  const ES_AGENDA = location.pathname.startsWith(URL_AGENDA);
  const ACTUALIZAR_CADA_MS = 10 * 60 * 1000; // Agenda: refresco automático en segundo plano
  const ACTUALIZAR_AL_VOLVER_MS = 5 * 60 * 1000; // Agenda: al abrir o volver a la pestaña, si la lista tiene más de esto

  // Claves en localStorage (compartidas con llamada-seguimiento.user.js:
  // ambas corren en intranet.hannacolombia.com, así que ven el mismo almacenamiento).
  const K = {
    cfg: 'hanna_pl_config',
    plan: 'hanna_plan_llamadas',      // carga por día + fecha sugerida (la lee el script de llamada)
    foto: 'hanna_pl_foto',            // última foto de la lista: { fecha, items: { otst: fechaProx|null } }
    inicioDia: 'hanna_pl_inicio_dia', // primera foto del día (para contar las llamadas hechas hoy)
    vistos: 'hanna_pl_vistos',        // otst -> día en que apareció por primera vez ('inicial' si ya estaba)
    hist: 'hanna_pl_historial',       // resumen diario
    listaHoy: 'hanna_pl_lista_hoy',   // lista congelada del día
    contactos: 'hanna_pl_contactos',  // otst -> { n: nombre, t: timestamp }
    abierto: 'hanna_pl_abierto',
    filas: 'hanna_pl_filas',          // última lectura completa del Libro de Trabajo: { ts, filas }
    log: 'hanna_llamadas_log',        // bitácora que escribe llamada-seguimiento.user.js al dar Continuar
  };

  const CFG_DEF = { cupoTotal: 40, cupoSeg: 10, diasGrafico: 10, alertaSemanas: 8 };
  const DIAS_CORTOS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];

  // ─────────────────────────────────────────────
  // Utilidades
  // ─────────────────────────────────────────────
  const leer = (k, def) => { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const norm = (t) => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const limpio = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');

  const d0 = (f) => new Date(f.getFullYear(), f.getMonth(), f.getDate());
  const clave = (f) => `${f.getFullYear()}-${pad(f.getMonth() + 1)}-${pad(f.getDate())}`;
  const deClave = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const corta = (k) => { const f = deClave(k); return `${DIAS_CORTOS[f.getDay()]} ${pad(f.getDate())}/${pad(f.getMonth() + 1)}`; };

  function parsear(txt) {
    const m = (txt || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    return d.getMonth() === +m[2] - 1 ? d : null;
  }

  // "19sem 5d 16h 59m" / "1d 23h 42m" / "21h 39m" -> días (decimal)
  function diasDe(txt) {
    const n = (re) => +((txt.match(re) || [])[1] || 0);
    return n(/(\d+)\s*sem/) * 7 + n(/(\d+)\s*d\b/) + n(/(\d+)\s*h\b/) / 24;
  }

  // ─────────────────────────────────────────────
  // Días hábiles y festivos de Colombia (Ley Emiliani)
  // ─────────────────────────────────────────────
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
    const alLunes = (f) => { const r = d0(f); while (r.getDay() !== 1) r.setDate(r.getDate() + 1); return r; };
    // Fijos
    [[0, 1], [4, 1], [6, 20], [7, 7], [11, 8], [11, 25]].forEach(([m, d]) => add(new Date(y, m, d)));
    // Se trasladan al lunes siguiente
    [[0, 6], [2, 19], [5, 29], [7, 15], [9, 12], [10, 1], [10, 11]].forEach(([m, d]) => add(alLunes(new Date(y, m, d))));
    // Dependen de la Pascua
    const p = pascua(y);
    [-3, -2, 43, 64, 71].forEach((n) => { const r = new Date(p); r.setDate(r.getDate() + n); add(r); });
    return (cacheFestivos[y] = s);
  }

  const esHabil = (f) => f.getDay() !== 0 && f.getDay() !== 6 && !festivos(f.getFullYear()).has(clave(f));
  function sigHabil(f) { const r = d0(f); do { r.setDate(r.getDate() + 1); } while (!esHabil(r)); return r; }
  function habilesEntre(aK, bK) { // días hábiles en (a, b]
    let n = 0; const b = deClave(bK); for (let r = deClave(aK); r < b;) { r = sigHabil(r); if (r <= b) n++; } return n;
  }

  // ─────────────────────────────────────────────
  // Lectura de la tabla "Esperando Llamada Seguimiento Diagnóstico"
  // (se ubica por el texto de los encabezados, no por nombres internos)
  // ─────────────────────────────────────────────
  function tablaLlamadas(raiz = document) {
    return [...raiz.querySelectorAll('table')].find((t) =>
      t.rows.length > 1 && !t.classList.contains('sticky-header') && /fecha próximo contacto/i.test(t.rows[0].textContent)) || null;
  }

  function leerFilas(t) {
    const cab = [...t.rows[0].cells].map((c) => norm(c.textContent));
    const col = (re) => cab.findIndex((h) => re.test(h));
    const iO = col(/^otst/), iE = col(/estado/), iT = col(/^tiempo/), iF = col(/próximo contacto/),
      iC = col(/^cliente/), iTec = col(/técnico/), iG = col(/garant/);
    return [...t.rows].slice(1).map((r) => {
      const c = r.cells;
      const tx = (i) => (i >= 0 && c[i] ? limpio(c[i].textContent) : '');
      const otst = (tx(iO).match(/\d+/) || [])[0];
      if (!otst) return null;
      const f = parsear(tx(iF));
      const sem = iE >= 0 && c[iE] ? c[iE].querySelector('[class*="semaforo_"]') : null;
      return {
        otst, tiempo: tx(iT), dias: diasDe(tx(iT)), fecha: f ? clave(f) : null,
        cliente: tx(iC), tecnico: tx(iTec), garantia: iG >= 0 && !/^no$/i.test(tx(iG)),
        semaforo: sem ? (sem.className.match(/semaforo_(\w+)/) || [])[1] || '' : '',
      };
    }).filter(Boolean);
  }

  // Aplica las llamadas registradas por llamada-seguimiento.user.js DESPUÉS de la
  // última lectura del Libro de Trabajo: así la lista marca ✅ y la carga por día
  // se ajusta al instante, sin esperar a volver a leer el Libro (≈6 s).
  // Reprogramada -> toma la nueva fecha. Efectiva -> sale de la lista.
  function aplicarBitacora(filas, tsLectura) {
    const ultimas = {};
    leer(K.log, []).forEach((e) => {
      if (e && e.otst && new Date(e.ts).getTime() > tsLectura) ultimas[e.otst] = e;
    });
    if (!Object.keys(ultimas).length) return filas.map((f) => ({ ...f }));
    return filas
      .filter((f) => !(ultimas[f.otst] && ultimas[f.otst].accion === 'efectiva'))
      .map((f) => (ultimas[f.otst] && ultimas[f.otst].fecha ? { ...f, fecha: ultimas[f.otst].fecha } : { ...f }));
  }

  // ─────────────────────────────────────────────
  // Plan: cola de seguimiento (máx. cupoSeg por día hábil, lo más atrasado primero)
  // + nuevas sin contacto (el resto del cupo total), de la más antigua a la más reciente
  // ─────────────────────────────────────────────
  function planificar(filas, hoy, cfg) {
    const hoyK = clave(hoy);
    const inicio = esHabil(hoy) ? d0(hoy) : sigHabil(hoy);
    const inicioK = clave(inicio);
    const carga = {};      // día -> seguimientos planeados
    const agenda = {};     // día -> seguimientos agendados en la intranet (sin redistribuir)

    const seg = filas.filter((f) => f.fecha).sort((a, b) => a.fecha.localeCompare(b.fecha) || b.dias - a.dias);
    for (const f of seg) {
      f.tipo = f.fecha < hoyK ? 'vencida' : f.fecha === hoyK ? 'hoy' : 'agendada';
      if (f.fecha >= hoyK) agenda[f.fecha] = (agenda[f.fecha] || 0) + 1;
      let d = f.fecha <= inicioK ? inicio : deClave(f.fecha);
      if (!esHabil(d)) d = sigHabil(d);
      while ((carga[clave(d)] || 0) >= cfg.cupoSeg) d = sigHabil(d);
      f.plan = clave(d);
      f.corrida = f.fecha >= hoyK && f.plan !== f.fecha;
      carga[f.plan] = (carga[f.plan] || 0) + 1;
    }

    const nuevas = filas.filter((f) => !f.fecha).sort((a, b) => b.dias - a.dias);
    let d = inicio, usados = 0;
    const cupoNuevasDe = (k) => Math.max(0, cfg.cupoTotal - Math.min(cfg.cupoSeg, carga[k] || 0));
    for (const f of nuevas) {
      while (usados >= cupoNuevasDe(clave(d))) { d = sigHabil(d); usados = 0; }
      f.tipo = 'nueva'; f.plan = clave(d); usados++;
    }

    // Fecha sugerida para reprogramar: primer día hábil después de hoy con cupo de seguimiento
    let s = sigHabil(hoy);
    while ((carga[clave(s)] || 0) >= cfg.cupoSeg) s = sigHabil(s);

    const ultimoSeg = seg.reduce((m, f) => (f.plan > m ? f.plan : m), inicioK);
    const ultimoNuevas = nuevas.reduce((m, f) => (f.plan > m ? f.plan : m), inicioK);
    return { hoyK, inicioK, seg, nuevas, carga, agenda, sugerida: clave(s), ultimoSeg, ultimoNuevas };
  }

  // ─────────────────────────────────────────────
  // Foto diaria: detecta nuevas OTST, avance del día y guarda historial
  // ─────────────────────────────────────────────
  function registrar(filas, plan, cfg) {
    const hoyK = plan.hoyK;
    const actual = {};
    filas.forEach((f) => { actual[f.otst] = f.fecha; });

    // OTST vistas por primera vez (la primera ejecución marca todo como 'inicial')
    const vistos = leer(K.vistos, null);
    const primeraVez = !vistos;
    const v = vistos || {};
    let entradas = 0;
    filas.forEach((f) => {
      if (!v[f.otst]) { v[f.otst] = primeraVez ? 'inicial' : hoyK; }
      if (v[f.otst] === hoyK) entradas++;
    });
    // Olvidar las que llevan más de 180 días fuera de la lista
    const limite = clave(new Date(Date.now() - 180 * 864e5));
    Object.keys(v).forEach((o) => { if (!(o in actual) && v[o] !== 'inicial' && v[o] < limite) delete v[o]; });
    guardar(K.vistos, v);

    // Avance del día: toda OTST que cambió de fecha o salió del estado desde la
    // primera foto del día cuenta como llamada hecha (esté o no en la lista de hoy).
    let ini = leer(K.inicioDia, null);
    if (!ini || ini.fecha !== hoyK) { ini = { fecha: hoyK, items: actual }; guardar(K.inicioDia, ini); }
    const hecha = (o, fechaIni) => !(o in actual) || actual[o] !== fechaIni;
    let hechasSeg = 0, hechasNuevas = 0, cerradas = 0;
    Object.entries(ini.items).forEach(([o, f]) => {
      if (!hecha(o, f)) return;
      if (f === null) hechasNuevas++; else hechasSeg++;
      if (!(o in actual)) cerradas++;
    });

    // Lista del día: se congela en la primera carga del día para poder marcar el avance
    let lista = leer(K.listaHoy, null);
    if (!lista || lista.fecha !== hoyK) lista = congelarLista(plan, hoyK);
    lista.items.forEach((it) => { it.hecha = hecha(it.otst, it.fechaIni); });
    guardar(K.listaHoy, lista);

    // Historial diario (se sobrescribe el del día en cada carga)
    const hist = leer(K.hist, {});
    hist[hoyK] = {
      total: filas.length,
      vencidas: plan.seg.filter((f) => f.tipo === 'vencida').length,
      hoy: plan.seg.filter((f) => f.tipo === 'hoy').length,
      sinContacto: plan.nuevas.length,
      agendadas: plan.seg.filter((f) => f.tipo === 'agendada').length,
      entradas: primeraVez ? null : entradas,
      hechasSeg, hechasNuevas, cerradas,
    };
    Object.keys(hist).sort().slice(0, -180).forEach((k) => delete hist[k]);
    guardar(K.hist, hist);
    guardar(K.foto, { fecha: hoyK, items: actual });

    // Plan para el script de llamada (carga de seguimiento por día)
    guardar(K.plan, { generado: new Date().toISOString(), hoy: hoyK, cupoSeg: cfg.cupoSeg, carga: plan.carga, sugerida: plan.sugerida });

    return { lista, hist, entradas: primeraVez ? null : entradas, hechasSeg, hechasNuevas, cerradas };
  }

  function congelarLista(plan, hoyK) {
    const items = [...plan.seg, ...plan.nuevas]
      .filter((f) => f.plan === plan.inicioK)
      .map((f) => ({ otst: f.otst, tipo: f.tipo, fechaIni: f.fecha }));
    return { fecha: hoyK, items };
  }

  // Promedio de OTST nuevas por día hábil (con la foto diaria). Mientras no haya
  // historial se estima con las que llevan menos de una semana en la lista.
  function entradasPromedio(hist, filas) {
    const dias = Object.keys(hist).filter((k) => hist[k].entradas !== null && esHabil(deClave(k))).sort().slice(-15);
    if (dias.length >= 3) return { valor: dias.reduce((a, k) => a + hist[k].entradas, 0) / dias.length, estimado: false };
    return { valor: filas.filter((f) => f.dias < 7).length / 5, estimado: true };
  }

  // ─────────────────────────────────────────────
  // Contactos (para distinguir "misma empresa, distinto contacto")
  // Solo se consultan las OTST de clientes con varias OTST abiertas.
  // ─────────────────────────────────────────────
  const contactos = leer(K.contactos, {});
  let colaContactos = [];
  let consultando = false;

  function pedirContactos(otsts, alTerminar) {
    const ahora = Date.now();
    colaContactos.push(...otsts.filter((o) => !contactos[o] || ahora - contactos[o].t > 7 * 864e5));
    if (consultando || !colaContactos.length) return;
    consultando = true;
    (async () => {
      while (colaContactos.length) {
        const o = colaContactos.shift();
        try {
          const h = await (await fetch(`/stecnico/item/${o}`, { credentials: 'same-origin' })).text();
          const doc = new DOMParser().parseFromString(h, 'text/html');
          const fila = [...doc.querySelectorAll('table.detailData tr')].find((r) => r.cells[0] && /^contacto/i.test(limpio(r.cells[0].textContent)));
          const span = fila && fila.cells[1] && (fila.cells[1].querySelector('b, strong') || fila.cells[1].querySelector('span'));
          const nombre = span ? limpio(span.textContent).replace(/\s*Editar$/i, '') : '';
          contactos[o] = { n: nombre, t: Date.now() };
          guardar(K.contactos, contactos);
        } catch (e) {
          // Se marca con nombre vacío para no reintentar en bucle; se vuelve a consultar en 7 días
          contactos[o] = { n: '', t: Date.now() };
        }
        await new Promise((r) => setTimeout(r, 350));
      }
      consultando = false;
      alTerminar();
    })();
  }

  // ─────────────────────────────────────────────
  // Estilos
  // ─────────────────────────────────────────────
  function estilos() {
    if (document.getElementById('hpl-styles')) return;
    const s = document.createElement('style');
    s.id = 'hpl-styles';
    s.textContent = `
      #hpl { margin: 14px 0; border: 1px solid #cfd8e3; border-radius: 10px; background: #fff; font-family: Arial, sans-serif; color: #1f2d3d; box-shadow: 0 2px 10px rgba(0,40,90,.08); }
      #hpl .hpl-top { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #f3f8fd; border-bottom: 1px solid #dfe7f0; border-radius: 10px 10px 0 0; cursor: pointer; }
      #hpl .hpl-top h3 { margin: 0; font-size: 16px; color: #0b3d78; }
      #hpl .hpl-top .hpl-sub { font-size: 12px; color: #6b7a8c; flex: 1; }
      #hpl .hpl-top button, #hpl .hpl-top a.hpl-btn { border: 1px solid #b7cbe3; background: #fff; color: #0b3d78; border-radius: 6px; padding: 3px 8px; font-size: 12px; cursor: pointer; text-decoration: none; white-space: nowrap; }
      #hpl .hpl-top a.hpl-btn:hover, #hpl .hpl-top button:hover { background: #eaf2fb; }
      #hpl .hpl-estado { font-size: 12px; color: #6b7a8c; white-space: nowrap; }
      #hpl .hpl-estado.error { color: #c0392b; font-weight: 700; white-space: normal; }
      #hpl.agenda { margin-top: 0; }
      #hpl.agenda .hpl-top { cursor: default; }
      /* En la Agenda la lista de hoy va justo debajo de los indicadores */
      #hpl.agenda .hpl-body { display: flex; flex-direction: column; }
      #hpl.agenda .hpl-kpis { order: -2; }
      #hpl.agenda .hpl-lista-card { order: -1; margin-bottom: 12px; }
      #hpl .hpl-cargando { font-size: 14px; color: #6b7a8c; margin: 20px 0; }
      #hpl .hpl-body { padding: 12px 14px; }
      #hpl.cerrado .hpl-body { display: none; }
      #hpl .hpl-kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 12px; }
      #hpl .hpl-kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 10px; background: #fafcfe; }
      #hpl .hpl-kpi .v { font-size: 22px; font-weight: 700; color: #0b3d78; line-height: 1.1; }
      #hpl .hpl-kpi .l { font-size: 11px; color: #6b7a8c; margin-top: 2px; }
      #hpl .hpl-kpi.rojo .v { color: #c0392b; } #hpl .hpl-kpi.ambar .v { color: #b7791f; } #hpl .hpl-kpi.verde .v { color: #2f855a; }
      #hpl .hpl-barra { height: 6px; background: #e2e8f0; border-radius: 3px; margin-top: 5px; overflow: hidden; }
      #hpl .hpl-barra > i { display: block; height: 100%; background: #2f855a; }
      #hpl .hpl-alertas { margin: 0 0 12px; padding: 0; list-style: none; }
      #hpl .hpl-alertas li { font-size: 13px; padding: 6px 10px; border-radius: 6px; margin-bottom: 4px; background: #fff6e0; border-left: 4px solid #e0a800; }
      #hpl .hpl-alertas li.rojo { background: #fdecea; border-left-color: #c0392b; }
      #hpl .hpl-alertas li.ok { background: #e9f7ef; border-left-color: #2f855a; }
      #hpl .hpl-grid2 { display: grid; grid-template-columns: 3fr 2fr; gap: 14px; margin-bottom: 12px; }
      #hpl .hpl-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
      #hpl .hpl-card h4 { margin: 0 0 8px; font-size: 13px; color: #0b3d78; }
      #hpl .hpl-card .hpl-nota { font-size: 11px; color: #6b7a8c; margin-top: 6px; }
      #hpl .hpl-chart { display: flex; align-items: flex-end; gap: 6px; height: 110px; position: relative; margin-top: 22px; border-bottom: 1px solid #cfd8e3; }
      #hpl .hpl-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; position: relative; }
      #hpl .hpl-col .pila { width: 70%; display: flex; flex-direction: column-reverse; }
      #hpl .hpl-col .pila i { display: block; width: 100%; }
      #hpl .hpl-col .num { font-size: 11px; font-weight: 700; color: #1f2d3d; }
      #hpl .hpl-col .intr { font-size: 10px; color: #c0392b; font-weight: 700; position: absolute; top: -20px; }
      #hpl .hpl-dias { display: flex; gap: 6px; }
      #hpl .hpl-dias .dia { flex: 1; text-align: center; font-size: 10px; color: #6b7a8c; margin-top: 3px; white-space: nowrap; }
      #hpl .hpl-linea { position: absolute; left: 0; right: 0; border-top: 2px dashed #c0392b; pointer-events: none; }
      #hpl .hpl-linea span { position: absolute; right: 0; top: -14px; font-size: 10px; color: #c0392b; }
      #hpl .hpl-leyenda { display: flex; gap: 12px; font-size: 11px; color: #6b7a8c; margin-top: 6px; flex-wrap: wrap; }
      #hpl .hpl-leyenda b { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
      #hpl .hpl-hbar { display: flex; align-items: center; gap: 8px; font-size: 12px; margin-bottom: 5px; }
      #hpl .hpl-hbar .et { width: 78px; color: #6b7a8c; }
      #hpl .hpl-hbar .tr { flex: 1; background: #eef2f7; border-radius: 3px; height: 14px; }
      #hpl .hpl-hbar .tr i { display: block; height: 100%; border-radius: 3px; }
      #hpl .hpl-hbar .n { width: 28px; text-align: right; font-weight: 700; }
      #hpl .hpl-tabs { display: flex; gap: 6px; margin-bottom: 8px; }
      #hpl .hpl-tabs button { border: 1px solid #b7cbe3; background: #fff; color: #0b3d78; border-radius: 14px; padding: 4px 12px; font-size: 12px; cursor: pointer; }
      #hpl .hpl-tabs button.act { background: #0b6fd6; border-color: #0b6fd6; color: #fff; font-weight: 700; }
      #hpl .hpl-tabs .sp { flex: 1; }
      #hpl table.hpl-lista { width: 100%; border-collapse: collapse; font-size: 12.5px; }
      #hpl table.hpl-lista th { text-align: left; font-size: 11px; color: #6b7a8c; border-bottom: 1px solid #dfe7f0; padding: 4px 6px; }
      #hpl table.hpl-lista td { border-bottom: 1px solid #f0f3f7; padding: 5px 6px; vertical-align: top; }
      #hpl table.hpl-lista tr.hecha td { opacity: .45; }
      #hpl table.hpl-lista tr.hecha td.ok { opacity: 1; }
      #hpl table.hpl-lista tr.grupo td { border-top: 2px solid #b7cbe3; }
      #hpl .tag { display: inline-block; border-radius: 10px; padding: 1px 7px; font-size: 11px; font-weight: 700; white-space: nowrap; }
      #hpl .tag.vencida { background: #fdecea; color: #c0392b; } #hpl .tag.hoy { background: #fff1c2; color: #8a6100; }
      #hpl .tag.agendada { background: #e6f0fb; color: #0b3d78; } #hpl .tag.nueva { background: #e9f7ef; color: #2f855a; }
      #hpl .tag.multi { background: #efe7fb; color: #5b2c99; font-weight: 400; }
      #hpl .tag.gar { background: #fff1c2; color: #8a6100; font-weight: 400; }
      #hpl .contacto { color: #6b7a8c; font-size: 11.5px; }
      #hpl a.llamar { font-weight: 700; }
    `;
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────
  // Interfaz
  // ─────────────────────────────────────────────
  let pestana = 'seg';
  // Última lectura del Libro de Trabajo (de la página actual o guardada)
  let datos = { filas: [], ts: 0 };
  let actualizando = false;
  let errorLectura = '';

  function render() {
    if (!datos.ts) { pintarCargando(); return; }
    const filas = aplicarBitacora(datos.filas, datos.ts);
    const cfg = { ...CFG_DEF, ...leer(K.cfg, {}) };
    const hoy = d0(new Date());
    const plan = planificar(filas, hoy, cfg);
    const reg = registrar(filas, plan, cfg);
    const porOtst = {}; filas.forEach((f) => { porOtst[f.otst] = f; });

    // Clientes con varias OTST abiertas (posible cierre de varias con una llamada)
    const porCliente = {};
    filas.forEach((f) => { (porCliente[f.cliente] = porCliente[f.cliente] || []).push(f.otst); });

    const nVenc = plan.seg.filter((f) => f.tipo === 'vencida').length;
    const nHoy = plan.seg.filter((f) => f.tipo === 'hoy').length;
    const nAg = plan.seg.filter((f) => f.tipo === 'agendada').length;
    const diasColaSeg = habilesEntre(plan.inicioK, plan.ultimoSeg) + 1;
    const diasColaNuevas = habilesEntre(plan.inicioK, plan.ultimoNuevas) + 1;
    const hechas = reg.hechasSeg + reg.hechasNuevas;
    const ent = entradasPromedio(reg.hist, filas);
    const cupoNuevasHoy = cfg.cupoTotal - Math.min(cfg.cupoSeg, plan.carga[plan.inicioK] || 0);

    // Alertas
    const alertas = [];
    const sobrecargados = Object.keys(plan.agenda).filter((k) => plan.agenda[k] > cfg.cupoSeg).sort();
    if (nVenc) alertas.push(['rojo', `${nVenc} OTST vencidas. Con ${cfg.cupoSeg} seguimientos por día, la cola de seguimiento llega hasta el <b>${corta(plan.ultimoSeg)}</b> (${diasColaSeg} días hábiles).`]);
    if (sobrecargados.length) alertas.push(['', `Días con más de ${cfg.cupoSeg} llamadas agendadas en la intranet: ${sobrecargados.map((k) => `<b>${corta(k)}</b> (${plan.agenda[k]})`).join(', ')}. El excedente se corre al siguiente día con cupo.`]);
    if (ent.valor > cfg.cupoTotal - cfg.cupoSeg) alertas.push(['rojo', `Entran ~${ent.valor.toFixed(1)} OTST nuevas por día hábil${ent.estimado ? ' (estimado)' : ''} y el cupo de nuevas es ${cfg.cupoTotal - cfg.cupoSeg}: la lista de nuevas va a crecer aunque se cumpla la meta.`]);
    if (diasColaNuevas > 1) alertas.push(['', `${plan.nuevas.length} OTST sin contacto: con ${cfg.cupoTotal - cfg.cupoSeg}+ por día se alcanzan a llamar todas en ${diasColaNuevas} días hábiles.`]);
    const viejas = filas.filter((f) => f.dias >= cfg.alertaSemanas * 7).sort((a, b) => b.dias - a.dias);
    if (viejas.length) alertas.push(['', `${viejas.length} OTST con más de ${cfg.alertaSemanas} semanas en este estado: ${viejas.slice(0, 6).map((f) => `<a href="/stecnico/item/${f.otst}" target="hpl_otst">${f.otst}</a> (${Math.floor(f.dias / 7)} sem)`).join(', ')}${viejas.length > 6 ? '…' : ''}. Considera cierre o disposición final.`]);
    const multis = Object.entries(porCliente).filter(([, l]) => l.length > 1);
    if (multis.length) alertas.push(['ok', `${multis.length} clientes tienen varias OTST abiertas (${multis.reduce((a, [, l]) => a + l.length, 0)} en total): revisa si el contacto es el mismo para resolverlas en una sola llamada.`]);
    if (!alertas.length) alertas.push(['ok', 'Todo al día: ninguna vencida ni día sobrecargado.']);

    // Gráfico de carga de los próximos días hábiles
    const dias = [];
    for (let d = deClave(plan.inicioK); dias.length < cfg.diasGrafico; d = sigHabil(d)) dias.push(clave(d));
    const maxY = Math.max(cfg.cupoSeg + 2, ...dias.map((k) => Math.max(plan.carga[k] || 0, plan.agenda[k] || 0)));
    const alto = (n) => `${(n / maxY) * 100}%`;
    const barras = dias.map((k) => {
      const enDia = plan.seg.filter((f) => f.plan === k);
      const propias = enDia.filter((f) => f.fecha === k).length;
      const movidas = enDia.length - propias;
      const intr = plan.agenda[k] || 0;
      return `<div class="hpl-col" title="${corta(k)}: ${enDia.length} planeadas (${propias} agendadas para ese día, ${movidas} vencidas o corridas)${intr ? ` · ${intr} agendadas en la intranet` : ''}">
        ${intr > cfg.cupoSeg ? `<span class="intr">${intr}⚠</span>` : ''}
        <span class="num">${enDia.length || ''}</span>
        <div class="pila" style="height:${alto(enDia.length)}">
          <i style="height:${enDia.length ? (propias / enDia.length) * 100 : 0}%;background:#0b6fd6"></i>
          <i style="height:${enDia.length ? (movidas / enDia.length) * 100 : 0}%;background:#e8913a"></i>
        </div>
      </div>`;
    }).join('');
    const etiquetasDias = dias.map((k) => `<span class="dia">${corta(k)}</span>`).join('');

    // Envejecimiento (columna "Tiempo")
    const tramos = [['< 1 sem', 0, 7], ['1–2 sem', 7, 14], ['2–4 sem', 14, 30], ['1–3 meses', 30, 91], ['> 3 meses', 91, 1e9]];
    const colores = ['#2f855a', '#7cb342', '#e0a800', '#e8913a', '#c0392b'];
    const conteos = tramos.map(([, a, b]) => filas.filter((f) => f.dias >= a && f.dias < b).length);
    const maxT = Math.max(1, ...conteos);
    const envej = tramos.map(([et], i) => `<div class="hpl-hbar"><span class="et">${et}</span><span class="tr"><i style="width:${(conteos[i] / maxT) * 100}%;background:${colores[i]}"></i></span><span class="n">${conteos[i]}</span></div>`).join('');

    // Tendencia (historial de fotos diarias)
    const hk = Object.keys(reg.hist).sort().slice(-10);
    const tendencia = hk.length >= 2
      ? `<table class="hpl-lista"><tr><th>Día</th><th>Pendientes</th><th>Vencidas</th><th>Sin contacto</th><th>Entraron</th><th>Llamadas</th></tr>${hk.map((k) => { const h = reg.hist[k]; return `<tr><td>${corta(k)}</td><td>${h.total}</td><td>${h.vencidas}</td><td>${h.sinContacto}</td><td>${h.entradas ?? '–'}</td><td>${h.hechasSeg + h.hechasNuevas}</td></tr>`; }).join('')}</table>`
      : '<div class="hpl-nota">La tendencia aparece desde el segundo día de uso (el script toma una foto de la lista cada vez que abres el Libro de Trabajo).</div>';

    // Lista del día (congelada en la primera carga del día)
    const items = reg.lista.items.filter((it) => (pestana === 'seg' ? it.tipo !== 'nueva' : it.tipo === 'nueva'));
    // Agrupar por cliente dentro de la lista (cada grupo queda donde aparece su primera OTST)
    const cliDe = (it) => (porOtst[it.otst] ? porOtst[it.otst].cliente : `#${it.otst}`);
    const primero = {};
    items.forEach((it, i) => { if (!(cliDe(it) in primero)) primero[cliDe(it)] = i; });
    const orden = items.map((it, i) => ({ it, i })).sort((a, b) => primero[cliDe(a.it)] - primero[cliDe(b.it)] || a.i - b.i).map((x) => x.it);
    const multiOtsts = new Set(multis.flatMap(([, l]) => l));
    let cliAnterior = null;
    const filasLista = orden.map((it, i) => {
      const f = porOtst[it.otst];
      const cli = f ? f.cliente : '(ya no está en la lista)';
      const otras = f ? (porCliente[f.cliente] || []).filter((o) => o !== it.otst) : [];
      const c = contactos[it.otst];
      const etiqueta = it.tipo === 'vencida' ? `Vencida ${it.fechaIni ? corta(it.fechaIni) : ''}` : it.tipo === 'hoy' ? 'Hoy' : it.tipo === 'agendada' ? `Agendada ${corta(it.fechaIni)}` : 'Sin contacto';
      const nuevoGrupo = cli !== cliAnterior && i > 0; cliAnterior = cli;
      return `<tr class="${it.hecha ? 'hecha' : ''} ${nuevoGrupo && otras.length ? 'grupo' : ''}">
        <td class="ok">${it.hecha ? '✅' : i + 1}</td>
        <td><a href="/stecnico/item/${it.otst}" target="hpl_otst">${it.otst}</a></td>
        <td><span class="tag ${it.tipo}">${esc(etiqueta)}</span>${f && f.garantia ? ' <span class="tag gar">Garantía</span>' : ''}</td>
        <td>${esc(cli)}${otras.length ? ` <span class="tag multi" title="Otras OTST abiertas de este cliente: ${otras.join(', ')}">+${otras.length} OTST: ${otras.join(', ')}</span>` : ''}
          ${multiOtsts.has(it.otst) ? `<div class="contacto">${c ? (c.n ? '👤 ' + esc(c.n) : '👤 sin nombre') : '👤 consultando…'}</div>` : ''}</td>
        <td>${f ? esc(f.tiempo) : ''}</td>
        <td>${f ? esc(f.tecnico) : ''}</td>
        <td>${it.hecha ? (f ? 'Reprogramada' : 'Salió del estado') : `<a class="llamar" href="/stecnico/item/${it.otst}/diagnosiscall" target="hpl_otst">📞 Llamar</a>`}</td>
      </tr>`;
    }).join('');
    const nSegLista = reg.lista.items.filter((it) => it.tipo !== 'nueva').length;
    const nNueLista = reg.lista.items.length - nSegLista;

    const sugerida = deClave(plan.sugerida);
    const html = `
      <div class="hpl-top">
        <h3>📞 ${ES_AGENDA ? 'Agenda de llamadas' : 'Planificador de llamadas'}</h3>
        <span class="hpl-sub">${esc(corta(plan.hoyK))} · cupo ${cfg.cupoTotal} diarias = máx. ${cfg.cupoSeg} de seguimiento + ${cfg.cupoTotal - cfg.cupoSeg} nuevas · fecha sugerida para reprogramar: <b>${pad(sugerida.getDate())}/${pad(sugerida.getMonth() + 1)}/${sugerida.getFullYear()}</b> · v${VERSION}</span>
        ${botonesTop()}
      </div>
      <div class="hpl-body">
        <div class="hpl-kpis">
          <div class="hpl-kpi ${hechas >= cfg.cupoTotal ? 'verde' : ''}"><div class="v">${hechas}/${cfg.cupoTotal}</div><div class="l">Llamadas hoy (${reg.hechasSeg} seguimiento · ${reg.hechasNuevas} nuevas)</div><div class="hpl-barra"><i style="width:${Math.min(100, (hechas / cfg.cupoTotal) * 100)}%"></i></div></div>
          <div class="hpl-kpi ${nVenc ? 'rojo' : 'verde'}"><div class="v">${nVenc}</div><div class="l">Vencidas</div></div>
          <div class="hpl-kpi ${nHoy > cfg.cupoSeg ? 'ambar' : ''}"><div class="v">${nHoy}</div><div class="l">Agendadas para hoy</div></div>
          <div class="hpl-kpi"><div class="v">${plan.nuevas.length}</div><div class="l">Sin contacto (nuevas)</div></div>
          <div class="hpl-kpi"><div class="v">${nAg}</div><div class="l">Agendadas a futuro</div></div>
          <div class="hpl-kpi ${diasColaSeg > 5 ? 'rojo' : diasColaSeg > 2 ? 'ambar' : 'verde'}"><div class="v">${diasColaSeg} d</div><div class="l">Cola de seguimiento (días hábiles, hasta ${corta(plan.ultimoSeg)})</div></div>
        </div>
        <ul class="hpl-alertas">${alertas.map(([c, t]) => `<li class="${c}">${t}</li>`).join('')}</ul>
        <div class="hpl-grid2">
          <div class="hpl-card">
            <h4>Carga de seguimiento — próximos ${cfg.diasGrafico} días hábiles</h4>
            <div class="hpl-chart">${barras}<div class="hpl-linea" style="bottom:${alto(cfg.cupoSeg)}"><span>cupo ${cfg.cupoSeg}</span></div></div>
            <div class="hpl-dias">${etiquetasDias}</div>
            <div class="hpl-leyenda"><span><b style="background:#0b6fd6"></b>Agendadas para ese día</span><span><b style="background:#e8913a"></b>Vencidas o corridas por falta de cupo</span><span style="color:#c0392b">N⚠ = agendadas en la intranet por encima del cupo</span></div>
          </div>
          <div class="hpl-card">
            <h4>Antigüedad en "Llamada Seguimiento Diagnóstico"</h4>
            ${envej}
            <div class="hpl-nota">Entradas por día hábil: ~${ent.valor.toFixed(1)}${ent.estimado ? ' (estimado con las de menos de 1 semana; se vuelve exacto con unos días de uso)' : ' (promedio real)'}.</div>
          </div>
        </div>
        <div class="hpl-card" style="margin-bottom:12px"><h4>Tendencia</h4>${tendencia}</div>
        <div class="hpl-card hpl-lista-card">
          <div class="hpl-tabs">
            <button type="button" data-tab="seg" class="${pestana === 'seg' ? 'act' : ''}">Seguimiento de hoy (${nSegLista}/${cfg.cupoSeg})</button>
            <button type="button" data-tab="nue" class="${pestana === 'nue' ? 'act' : ''}">Nuevas de hoy (${nNueLista}/${cupoNuevasHoy})</button>
            <span class="sp"></span>
            <button type="button" data-act="recalc" title="Vuelve a armar la lista de hoy con el estado actual">↻ Recalcular lista de hoy</button>
          </div>
          <table class="hpl-lista">
            <tr><th>#</th><th>OTST</th><th>Tipo</th><th>Cliente</th><th>Tiempo</th><th>Técnico</th><th></th></tr>
            ${filasLista || '<tr><td colspan="7">No hay llamadas en esta lista.</td></tr>'}
          </table>
          <div class="hpl-nota">La lista se arma con la primera carga del día; ✅ = la OTST ya cambió de fecha o salió del estado. Seguimiento: lo más atrasado primero. Nuevas: las de mayor antigüedad primero.</div>
        </div>
      </div>`;

    const panel = montarPanel();
    panel.className = ES_AGENDA ? 'agenda' : leer(K.abierto, true) ? '' : 'cerrado';
    panel.innerHTML = html;
    pintarEstado();

    // Nombres de contacto de los clientes con varias OTST
    pedirContactos([...multiOtsts], render);
  }

  function botonesTop() {
    return `<span id="hpl-estado" class="hpl-estado"></span>
      ${ES_AGENDA
        ? `<button type="button" data-act="actualizar" title="Vuelve a leer el Libro de Trabajo (≈6 s, en segundo plano)">↻ Actualizar</button>
           <a class="hpl-btn" href="${URL_LIBRO}" target="_blank" title="Abre el Libro de Trabajo completo (lento)">Libro de Trabajo</a>`
        : `<a class="hpl-btn" href="${URL_AGENDA}" title="Abre la agenda rápida: carga al instante y se actualiza sola">⚡ Agenda rápida</a>`}
      <button type="button" data-act="csv" title="Descarga la lista de hoy en CSV (para Excel)">⬇ CSV de hoy</button>
      <button type="button" data-act="cfg" title="Cambiar cupos">⚙️ Cupos</button>`;
  }

  function montarPanel() {
    let panel = document.getElementById('hpl');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'hpl';
    if (ES_AGENDA) {
      // Esta URL no existe en la intranet y muestra la lista general de OTST:
      // se reemplaza el contenido por la agenda.
      const cont = document.querySelector('#contentcolumn') || document.querySelector('#content') || document.body;
      cont.innerHTML = '';
      cont.appendChild(panel);
      document.title = 'Agenda de llamadas | Intranet Hanna Instruments Colombia';
    } else {
      const t = tablaLlamadas();
      const ancla = document.querySelector('.lt_indicadores') || (t && (t.closest('.box') || t));
      ancla.insertAdjacentElement(ancla.classList.contains('lt_indicadores') ? 'afterend' : 'beforebegin', panel);
    }
    panel.addEventListener('click', alClic);
    return panel;
  }

  function pintarCargando() {
    const panel = montarPanel();
    panel.className = 'agenda';
    panel.innerHTML = `<div class="hpl-top"><h3>📞 Agenda de llamadas</h3><span class="hpl-sub">v${VERSION}</span>${botonesTop()}</div>
      <div class="hpl-body"><p class="hpl-cargando">Leyendo el Libro de Trabajo por primera vez (tarda unos segundos)… Desde la próxima vez la agenda abre al instante con la última lista guardada.</p></div>`;
    pintarEstado();
  }

  const haceTexto = (ts) => {
    const min = Math.floor((Date.now() - ts) / 60000);
    return min < 1 ? 'hace menos de 1 min' : min < 60 ? `hace ${min} min` : `hace ${Math.floor(min / 60)} h ${min % 60} min`;
  };

  function pintarEstado() {
    const el = document.getElementById('hpl-estado');
    if (!el) return;
    el.className = 'hpl-estado' + (errorLectura ? ' error' : '');
    if (actualizando) el.textContent = '⏳ Actualizando desde el Libro de Trabajo…';
    else if (errorLectura) el.textContent = `⚠ ${errorLectura}`;
    else if (ES_AGENDA && datos.ts) el.textContent = `Datos ${haceTexto(datos.ts)}`;
    else el.textContent = '';
  }

  // ─────────────────────────────────────────────
  // Lectura del Libro de Trabajo
  // ─────────────────────────────────────────────
  function guardarLectura(filas, ts) {
    datos = { filas, ts };
    guardar(K.filas, datos);
  }

  async function actualizarDesdeLibro() {
    if (actualizando) return;
    actualizando = true;
    errorLectura = '';
    pintarEstado();
    const inicio = Date.now(); // lo que se registre después de esto aún no está en la lectura
    try {
      const r = await fetch(URL_LIBRO, { credentials: 'same-origin' });
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      const t = tablaLlamadas(doc);
      if (t) guardarLectura(leerFilas(t), inicio);
      else if (/Esperando Llamada Seguimiento Diagn/i.test(doc.body ? doc.body.textContent : '')) guardarLectura([], inicio);
      else throw new Error('no se encontró la lista (¿se cerró la sesión de la intranet?)');
    } catch (e) {
      errorLectura = `No se pudo leer el Libro de Trabajo: ${e.message}`;
    }
    actualizando = false;
    render();
  }

  function exportarCSV() {
    const lista = leer(K.listaHoy, null);
    if (!lista || !lista.items.length) return;
    const info = {};
    datos.filas.forEach((f) => { info[f.otst] = f; });
    const fecha = (k) => (k ? k.split('-').reverse().join('/') : '');
    const tipo = { vencida: 'Vencida', hoy: 'Agendada hoy', agendada: 'Agendada', nueva: 'Sin contacto' };
    const q = (v) => (/[",;\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const filas = [['OTST', 'Cliente', 'Técnico Asignado', '¿En garantía?', 'Tipo', 'Fecha próximo contacto', 'Estado']];
    lista.items.forEach((it) => {
      const f = info[it.otst] || {};
      filas.push([it.otst, f.cliente || '', f.tecnico || '', f.garantia ? 'SI' : 'NO', tipo[it.tipo] || it.tipo, fecha(it.fechaIni), it.hecha ? 'Hecha' : 'Pendiente']);
    });
    const csv = '﻿' + filas.map((r) => r.map((v) => q(String(v))).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `llamadas_${lista.fecha}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function alClic(e) {
    const b = e.target.closest('button, .hpl-top');
    if (!b) return;
    if (b.dataset.tab) { pestana = b.dataset.tab; render(); return; }
    if (b.dataset.act === 'recalc') { localStorage.removeItem(K.listaHoy); render(); return; }
    if (b.dataset.act === 'actualizar') { actualizarDesdeLibro(); return; }
    if (b.dataset.act === 'csv') { exportarCSV(); return; }
    if (b.dataset.act === 'cfg') {
      const cfg = { ...CFG_DEF, ...leer(K.cfg, {}) };
      const total = parseInt(prompt('Llamadas por día (cupo total):', cfg.cupoTotal), 10);
      if (!total) return;
      const seg = parseInt(prompt('Máximo de seguimientos (vencidas/reprogramadas) por día:', cfg.cupoSeg), 10);
      if (!seg) return;
      guardar(K.cfg, { ...leer(K.cfg, {}), cupoTotal: total, cupoSeg: Math.min(seg, total) });
      localStorage.removeItem(K.listaHoy);
      render();
      return;
    }
    // Plegar/desplegar el panel (solo en el Libro de Trabajo)
    if (!ES_AGENDA && b.classList.contains('hpl-top') && !e.target.closest('a')) {
      guardar(K.abierto, !leer(K.abierto, true));
      document.getElementById('hpl').classList.toggle('cerrado');
    }
  }

  // ─────────────────────────────────────────────
  // Arranque
  // ─────────────────────────────────────────────
  // Cuando llamada-seguimiento.user.js registra una llamada (en otra pestaña),
  // se refleja al instante. Solo se escucha la bitácora: el plan lo reescriben
  // ambas pestañas y escucharlo haría un ping-pong.
  window.addEventListener('storage', (e) => { if (e.key === K.log && datos.ts) render(); });

  function iniciarLibro() {
    const t = tablaLlamadas();
    if (!t) return false;
    estilos();
    // Los datos son del momento en que se pidió la página
    guardarLectura(leerFilas(t), Math.round(performance.timeOrigin || Date.now()));
    render();
    return true;
  }

  function iniciarAgenda() {
    estilos();
    const g = leer(K.filas, null);
    if (g && Array.isArray(g.filas) && g.ts) datos = g;
    render();
    if (Date.now() - datos.ts > ACTUALIZAR_AL_VOLVER_MS) actualizarDesdeLibro();
    // Cada minuto: refresca el "hace X min" y, si toca, vuelve a leer el Libro
    setInterval(() => {
      pintarEstado();
      if (document.visibilityState === 'visible' && Date.now() - datos.ts > ACTUALIZAR_CADA_MS) actualizarDesdeLibro();
    }, 60 * 1000);
    // Al volver a la pestaña (por ejemplo, después de una llamada)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      render();
      if (Date.now() - datos.ts > ACTUALIZAR_AL_VOLVER_MS) actualizarDesdeLibro();
    });
  }

  if (ES_AGENDA) iniciarAgenda();
  else if (!iniciarLibro()) {
    let intentos = 0;
    const id = setInterval(() => { if (iniciarLibro() || ++intentos > 20) clearInterval(id); }, 500);
  }
})();
