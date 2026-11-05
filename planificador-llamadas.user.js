// ==UserScript==
// @name         Planificador de Llamadas de Seguimiento - Hanna Colombia
// @namespace    https://intranet.hannacolombia.com/
// @version      1.3.0
// @description  En el Libro de Trabajo y en la Agenda rápida (/stecnico/agenda-llamadas): arma tu lista de llamadas del día con tu cupo (p. ej. 40 = máx. 10 de seguimiento [vencidas/reprogramadas] + el resto nuevas sin contacto) y filtro "Mis técnicos", muestra la carga de los próximos días hábiles (con festivos de Colombia), alertas, envejecimiento y avance. La Agenda abre al instante con la última lista guardada y actualiza el Libro de Trabajo en segundo plano. Opcional: se sincroniza con un Google Sheet (Apps Script) para guardar la bitácora y los indicadores, y para que varias personas llamen desde la misma cola sin repetir OTST. Solo lee la intranet: nunca cambia fechas ni envía formularios.
// @author       Servicio Técnico Hanna Colombia
// @match        https://intranet.hannacolombia.com/stecnico/libro_trabajo*
// @match        https://intranet.hannacolombia.com/stecnico/agenda-llamadas*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/planificador-llamadas.user.js
// @downloadURL  https://raw.githubusercontent.com/serviciotecnico-hannacolombia/hanna-scripts/main/planificador-llamadas.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Debe coincidir siempre con @version del header de arriba.
  const VERSION = '1.3.0';
  const SYNC_CADA_MS = 20 * 1000;    // Sheet: cada cuánto se consulta la cola compartida (pestaña visible)
  const TOMADA_MIN = 20;             // una OTST "tomada" se libera sola a los 20 min si no se registra la llamada
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
    contactos: 'hanna_pl_contactos',  // otst -> { n: nombre, t: timestamp }
    abierto: 'hanna_pl_abierto',
    filas: 'hanna_pl_filas',          // última lectura completa del Libro de Trabajo: { ts, filas }
    log: 'hanna_llamadas_log',        // bitácora que escribe llamada-seguimiento.user.js al dar Continuar
  };

  // cupoTotal / cupoSeg: TU cupo diario (cada persona el suyo).
  // cupoSegEquipo: seguimientos por día hábil para reprogramar (regla del equipo;
  //   con esto se arma la cola y la fecha sugerida del script de llamada).
  // misTecnicos: si tiene nombres, tu lista solo toma OTST de esos técnicos.
  const CFG_DEF = { cupoTotal: 40, cupoSeg: 10, cupoSegEquipo: 10, misTecnicos: [], diasGrafico: 10, alertaSemanas: 8 };
  const config = () => {
    const c = { ...CFG_DEF, ...leer(K.cfg, {}) };
    if (!Array.isArray(c.misTecnicos)) c.misTecnicos = [];
    return c;
  };
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
      while ((carga[clave(d)] || 0) >= cfg.cupoSegEquipo) d = sigHabil(d);
      f.plan = clave(d);
      f.corrida = f.fecha >= hoyK && f.plan !== f.fecha;
      carga[f.plan] = (carga[f.plan] || 0) + 1;
    }

    const nuevas = filas.filter((f) => !f.fecha).sort((a, b) => b.dias - a.dias);
    let d = inicio, usados = 0;
    // Proyección: capNuevas = nuevas que el equipo alcanza a llamar por día
    const capNuevas = Math.max(1, cfg.capNuevas || cfg.cupoTotal - cfg.cupoSeg);
    for (const f of nuevas) {
      if (usados >= capNuevas) { d = sigHabil(d); usados = 0; }
      f.tipo = 'nueva'; f.plan = clave(d); usados++;
    }

    // Fecha sugerida para reprogramar: primer día hábil después de hoy con cupo de seguimiento
    let s = sigHabil(hoy);
    while ((carga[clave(s)] || 0) >= cfg.cupoSegEquipo) s = sigHabil(s);

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

    // OTST que cambiaron desde la primera foto del día (llamadas hechas, con o sin bitácora)
    const cambiadas = Object.keys(ini.items).filter((o) => hecha(o, ini.items[o]));

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
    guardar(K.plan, { generado: new Date().toISOString(), hoy: hoyK, cupoSeg: cfg.cupoSegEquipo, carga: plan.carga, sugerida: plan.sugerida });

    return { ini, actual, cambiadas, hist, entradas: primeraVez ? null : entradas, hechasSeg, hechasNuevas, cerradas };
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
  // Sincronización con Google Sheets (opcional, ver agenda-llamadas.gs)
  // - Envía al Sheet cada llamada de la bitácora local (la escribe
  //   llamada-seguimiento.user.js) y el resumen del día.
  // - Trae las llamadas de las demás personas y las OTST "tomadas" (en llamada).
  // La URL, la clave y tu nombre se guardan en Tampermonkey (no en la página).
  // ─────────────────────────────────────────────
  const gmGet = (k, d) => (typeof GM_getValue === 'function' ? GM_getValue(k, d) : leer(k, d));
  const gmSet = (k, v) => (typeof GM_setValue === 'function' ? GM_setValue(k, v) : guardar(k, v));
  const syncCfg = () => ({ url: (gmGet('hpl_sync_url', '') || '').trim(), clave: (gmGet('hpl_sync_clave', '') || '').trim(), usuario: (gmGet('hpl_sync_usuario', '') || '').trim() });
  const syncActivo = () => { const c = syncCfg(); return !!(c.url && c.clave && c.usuario); };
  const idDe = (e) => e.id || `${e.otst}|${e.ts}`;

  let remoto = { ok: null, error: '', ts: 0, tomadas: {}, activos: {} };
  let sincronizando = false;
  let syncPendiente = null;

  function pedirSheet(url, cuerpo) {
    return new Promise((resolve, reject) => {
      const alResponder = (texto) => { try { resolve(JSON.parse(texto)); } catch (e) { reject(new Error('respuesta inválida del Apps Script')); } };
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'POST', url, data: JSON.stringify(cuerpo), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, timeout: 20000,
          onload: (r) => alResponder(r.responseText),
          onerror: () => reject(new Error('sin conexión con el Apps Script')),
          ontimeout: () => reject(new Error('el Apps Script tardó demasiado')),
        });
      } else if (typeof window.__hplServidorPrueba === 'function') {
        window.__hplServidorPrueba(cuerpo).then((r) => resolve(r), reject); // solo para pruebas
      } else reject(new Error('Tampermonkey no permite la conexión'));
    });
  }

  // Tipo con el que empezó el día una OTST (para contar seguimiento vs nuevas)
  function tipoInicial(otst) {
    const ini = leer(K.inicioDia, null);
    const f = ini && ini.items ? ini.items[otst] : null;
    if (!f) return 'nueva';
    const hoyK = clave(new Date());
    return f < hoyK ? 'vencida' : f === hoyK ? 'hoy' : 'agendada';
  }

  async function sincronizar(extra) {
    if (!syncActivo()) return;
    if (sincronizando) { syncPendiente = { ...(syncPendiente || {}), ...(extra || {}) }; return; }
    sincronizando = true;
    const c = syncCfg();
    const cfg = config();
    const log = leer(K.log, []);
    const enviados = new Set(gmGet('hpl_sync_enviados', []));
    const info = {};
    datos.filas.forEach((f) => { info[f.otst] = f; });
    // Mis llamadas (las que escribió el script de llamada en ESTE navegador) aún no confirmadas
    const mias = log.filter((e) => e && e.otst && !e.usuario && !enviados.has(idDe(e))).slice(-100).map((e) => ({
      // llamada-seguimiento guarda la hora en ISO: se envía en milisegundos
      id: idDe(e), ts: new Date(e.ts).getTime() || Date.now(), otst: e.otst, accion: e.accion, fecha: e.fecha || '',
      tipo: e.tipo || tipoInicial(e.otst), cliente: (info[e.otst] || {}).cliente || '', tecnico: (info[e.otst] || {}).tecnico || '',
      grupo: e.grupo || '', otsts: Array.isArray(e.otsts) ? e.otsts : [],
    }));
    const hoyK = clave(new Date());
    const resumen = leer(K.hist, {})[hoyK];
    const resumenTxt = resumen ? JSON.stringify(resumen) : '';
    const cuerpo = {
      clave: c.clave, usuario: c.usuario, cupoTotal: cfg.cupoTotal, cupoSeg: cfg.cupoSeg, tecnicos: cfg.misTecnicos,
      llamadas: mias, ...(extra || {}),
    };
    if (resumen && resumenTxt !== gmGet('hpl_sync_resumen', '')) cuerpo.resumen = { dia: hoyK, ...resumen, colaDias: ultimaColaDias };
    try {
      const r = await pedirSheet(c.url, cuerpo);
      if (!r || !r.ok) throw new Error((r && r.error) || 'error desconocido');
      (r.recibidos || []).forEach((id) => enviados.add(id));
      gmSet('hpl_sync_enviados', [...enviados].slice(-3000));
      if (cuerpo.resumen) gmSet('hpl_sync_resumen', resumenTxt);
      // Llamadas de las demás personas -> bitácora local (así se marcan ✅ aquí también)
      const actualLog = leer(K.log, []);
      const ids = new Set(actualLog.map(idDe));
      let nuevos = 0;
      (r.bitacora || []).forEach((e) => {
        if (e && e.id && !ids.has(e.id) && e.usuario !== c.usuario) { actualLog.push({ ...e, remoto: true }); nuevos++; }
      });
      if (nuevos) guardar(K.log, actualLog.slice(-3000));
      remoto = { ok: true, error: '', ts: Date.now(), tomadas: r.tomadas || {}, activos: r.activos || {}, bitacora: r.bitacora || [] };
    } catch (e) {
      remoto = { ...remoto, ok: false, error: e.message };
    }
    sincronizando = false;
    if (datos.ts) render(); else pintarEstado();
    if (syncPendiente) { const p = syncPendiente; syncPendiente = null; sincronizar(p); }
  }

  function tomadaPorOtro(otst) {
    const t = remoto.tomadas && remoto.tomadas[otst];
    if (!t || t.usuario === syncCfg().usuario) return null;
    return Date.now() - t.ts < TOMADA_MIN * 60000 ? t : null;
  }

  function configurarSync() {
    const c = syncCfg();
    const url = prompt('URL de la aplicación web del Apps Script (termina en /exec). Déjala vacía para desactivar la sincronización:', c.url);
    if (url === null) return;
    if (!url.trim()) { gmSet('hpl_sync_url', ''); remoto = { ok: null, error: '', ts: 0, tomadas: {}, activos: {} }; render(); return; }
    const claveS = prompt('Clave secreta (la misma CLAVE de las propiedades del Apps Script):', c.clave);
    if (claveS === null) return;
    const usuario = prompt('Tu nombre (así te verán las demás personas en la agenda):', c.usuario || nombreIntranet());
    if (usuario === null || !usuario.trim()) return;
    gmSet('hpl_sync_url', url.trim());
    gmSet('hpl_sync_clave', claveS.trim());
    gmSet('hpl_sync_usuario', usuario.trim());
    sincronizar();
  }

  // Nombre de quien inició sesión, tomado de la barra superior de la intranet
  function nombreIntranet() {
    const el = [...document.querySelectorAll('b, strong, span, a, div')].find((x) => x.children.length === 0 && /\S/.test(x.textContent) &&
      x.nextSibling && /Usuario Manager/i.test(x.parentElement ? x.parentElement.textContent : ''));
    return el ? limpio(el.textContent) : '';
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
      #hpl .tag.seg { background: #f1e9ff; color: #4a2a85; }
      #hpl table.hpl-lista tr.sub td { border-bottom-color: #f6f2fb; }
      #hpl table.hpl-lista tr.sub td.ok { color: #8a97a8; text-align: right; }
      #hpl .mismo { color: #8a97a8; font-size: 11.5px; }
      #hpl .tag.multi { background: #efe7fb; color: #5b2c99; font-weight: 400; }
      #hpl .tag.gar { background: #fff1c2; color: #8a6100; font-weight: 400; }
      #hpl .contacto { color: #6b7a8c; font-size: 11.5px; }
      #hpl a.llamar { font-weight: 700; }
      #hpl .hpl-sync { font-size: 12px; white-space: nowrap; color: #6b7a8c; }
      #hpl .hpl-sync.ok { color: #2f855a; } #hpl .hpl-sync.error { color: #c0392b; font-weight: 700; }
      #hpl .hpl-tecs { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-bottom: 8px; font-size: 12px; }
      #hpl .hpl-tecs .t { color: #6b7a8c; }
      #hpl .hpl-tecs button { border: 1px solid #d5dde8; background: #fff; color: #1f2d3d; border-radius: 12px; padding: 2px 9px; font-size: 11.5px; cursor: pointer; }
      #hpl .hpl-tecs button small { color: #8a97a8; }
      #hpl .hpl-tecs button.act { background: #e6f0fb; border-color: #0b6fd6; color: #0b3d78; font-weight: 700; }
      #hpl .hpl-tecs .hpl-nota { margin: 0 0 0 6px; font-size: 11px; color: #6b7a8c; }
      #hpl table.hpl-lista tr.tomada td { background: #fafafa; color: #8a97a8; }
      #hpl table.hpl-lista tr.sep td { font-size: 11px; color: #6b7a8c; font-weight: 700; padding-top: 10px; border-bottom: 1px solid #dfe7f0; }
      #hpl .quien { font-size: 11px; color: #b7791f; margin-right: 6px; }
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
  let ultimaColaDias = null;  // se envía en el resumen diario del Sheet
  let ultimaLista = [];       // tu lista de hoy (para el CSV)

  function render() {
    if (!datos.ts) { pintarCargando(); return; }
    const filas = aplicarBitacora(datos.filas, datos.ts);
    const cfg = config();
    const sync = syncActivo();
    const yo = syncCfg().usuario;
    // Equipo: personas conectadas en la última media hora (según el Sheet)
    const activos = sync && remoto.ok ? Object.entries(remoto.activos || {}) : [];
    const capNuevasEquipo = activos.length
      ? activos.reduce((a, [, v]) => a + Math.max(0, (+v.cupoTotal || 0) - (+v.cupoSeg || 0)), 0)
      : cfg.cupoTotal - cfg.cupoSeg;
    cfg.capNuevas = capNuevasEquipo;
    const hoy = d0(new Date());
    const plan = planificar(filas, hoy, cfg);
    const reg = registrar(filas, plan, cfg);
    ultimaColaDias = habilesEntre(plan.inicioK, plan.ultimoSeg) + 1;
    // Incluye las que ya salieron del estado (para mostrar sus datos en "hechas")
    const infoBase = {}; datos.filas.forEach((f) => { infoBase[f.otst] = f; });

    // ── Llamadas de hoy: bitácora (tuya y del equipo) + cambios vistos en el Libro ──
    const hoyK = plan.hoyK;
    const ultimaDe = {};
    leer(K.log, []).forEach((e) => { if (e && e.otst && e.ts && clave(new Date(e.ts)) === hoyK) ultimaDe[e.otst] = e; });
    reg.cambiadas.forEach((o) => { if (!ultimaDe[o]) ultimaDe[o] = { otst: o, accion: o in reg.actual ? 'reprogramada' : 'salio', sinRegistro: true }; });
    // Sin Sheet todo lo hecho cuenta como tuyo; con Sheet, lo que no tiene registro no es de nadie
    const esMia = (e) => (e.sinRegistro ? !sync : !e.usuario || e.usuario === yo);
    const tipoIni = (o) => { const f = reg.ini.items[o]; return f == null ? 'nueva' : f < hoyK ? 'vencida' : f === hoyK ? 'hoy' : 'agendada'; };
    // Llamada agrupada (varias OTST de un cliente con el encabezado "Orden relacionada
    // con la OTST…", ver llamada-seguimiento.user.js): cuenta como UNA llamada
    const llamadaDe = (e) => (e.grupo ? `g${e.grupo}` : String(e.otst));
    const grupoDe = {}; // otst -> registro del grupo de hoy al que pertenece
    Object.values(ultimaDe).forEach((e) => { if (e.grupo && Array.isArray(e.otsts)) e.otsts.forEach((o) => { if (!grupoDe[o]) grupoDe[o] = e; }); });
    const misHechas = Object.values(ultimaDe).filter(esMia);
    const llamadas = {}; // clave de llamada -> { seg, entradas }
    misHechas.forEach((e) => {
      const l = (llamadas[llamadaDe(e)] = llamadas[llamadaDe(e)] || { seg: false, entradas: [] });
      l.entradas.push(e);
      if (tipoIni(e.otst) !== 'nueva') l.seg = true;
    });
    const llamadasSeg = Object.values(llamadas).filter((l) => l.seg);
    const llamadasNue = Object.values(llamadas).filter((l) => !l.seg);
    const porPersona = {};
    const contadas = new Set();
    Object.values(ultimaDe).forEach((e) => {
      const n = e.sinRegistro ? 'sin registro' : e.usuario || yo || 'Tú';
      if (contadas.has(n + '|' + llamadaDe(e))) return;
      contadas.add(n + '|' + llamadaDe(e));
      porPersona[n] = (porPersona[n] || 0) + 1;
    });

    // Clientes con varias OTST abiertas (se atienden todas en la misma llamada)
    const porCliente = {};
    filas.forEach((f) => { (porCliente[f.cliente] = porCliente[f.cliente] || []).push(f.otst); });
    const porOtst = {};
    filas.forEach((f) => { porOtst[f.otst] = f; });

    // ── Tu lista: siguientes clientes libres de la cola compartida hasta completar tu cupo ──
    // (un cliente = una llamada: sus demás OTST van debajo y no gastan cupo)
    const filtroTec = cfg.misTecnicos;
    const deMisTec = (f) => !filtroTec.length || filtroTec.includes(f.tecnico);
    const clienteTomado = {};
    filas.forEach((f) => { const t = tomadaPorOtro(f.otst); if (t && !clienteTomado[f.cliente]) clienteTomado[f.cliente] = t; });
    const libre = (f) => !ultimaDe[f.otst] && !grupoDe[f.otst] && !clienteTomado[f.cliente] && deMisTec(f);
    const usados = new Set();
    const elegir = (cands, n) => {
      const r = [];
      for (const f of cands) {
        if (r.length >= n) break;
        if (!libre(f) || usados.has(f.cliente)) continue;
        usados.add(f.cliente);
        r.push(f);
      }
      return r;
    };
    const pendientesSeg = plan.seg.filter((f) => f.tipo !== 'agendada'); // vencidas + hoy, lo más atrasado primero
    const pendSeg = elegir(pendientesSeg, Math.max(0, cfg.cupoSeg - llamadasSeg.length));
    const cupoNuevasMias = cfg.cupoTotal - Math.min(cfg.cupoSeg, llamadasSeg.length + pendSeg.length);
    const pendNue = elegir(plan.nuevas, Math.max(0, cupoNuevasMias - llamadasNue.length));
    const vistosOtros = new Set();
    const enLlamadaOtros = [...pendientesSeg, ...plan.nuevas].filter((f) => {
      if (ultimaDe[f.otst] || !deMisTec(f) || !clienteTomado[f.cliente] || vistosOtros.has(f.cliente)) return false;
      vistosOtros.add(f.cliente);
      return true;
    });

    // Filas de la lista: la llamada principal y, debajo (↳), las demás OTST del cliente
    const mayor = (l) => l.map(String).sort((a, b) => +b - +a)[0];
    const itemSub = (o, seg, falta) => ({ otst: String(o), tipo: porOtst[o] ? porOtst[o].tipo : tipoIni(o), fechaIni: porOtst[o] ? porOtst[o].fecha : reg.ini.items[o] || null, sub: true, seg: String(o) === seg, falta });
    const itemsHechos = (l) => {
      const g = l.entradas.find((e) => e.grupo && Array.isArray(e.otsts));
      const seg = g ? String(g.grupo) : null;
      const hechos = l.entradas.slice().sort((a, b) => +a.otst - +b.otst)
        .map((e, i) => ({ otst: String(e.otst), tipo: tipoIni(e.otst), fechaIni: reg.ini.items[e.otst] || null, hecha: e, sub: i > 0, seg: String(e.otst) === seg }));
      // OTST del grupo que aún faltan por registrar en la intranet
      const faltan = g ? g.otsts.map(String).filter((o) => !ultimaDe[o] && o in reg.actual).map((o) => itemSub(o, seg, true)) : [];
      return [...hechos, ...faltan];
    };
    const itemsPend = (f) => {
      const otras = (porCliente[f.cliente] || []).filter((o) => o !== f.otst && !ultimaDe[o] && !grupoDe[o]);
      const seg = otras.length ? mayor([f.otst, ...otras]) : null;
      const todas = otras.length ? [f.otst, ...otras] : null;
      return [{ otst: f.otst, tipo: f.tipo, fechaIni: f.fecha, seg: f.otst === seg, todas }, ...otras.map((o) => ({ ...itemSub(o, seg, false), todas }))];
    };
    const listaSeg = [...llamadasSeg.flatMap(itemsHechos), ...pendSeg.flatMap(itemsPend)];
    const listaNue = [...llamadasNue.flatMap(itemsHechos), ...pendNue.flatMap(itemsPend)];
    ultimaLista = [...listaSeg, ...listaNue];
    const cupoNuevasTxt = Math.max(0, cupoNuevasMias);

    const nVenc = plan.seg.filter((f) => f.tipo === 'vencida').length;
    const nHoy = plan.seg.filter((f) => f.tipo === 'hoy').length;
    const nAg = plan.seg.filter((f) => f.tipo === 'agendada').length;
    const diasColaSeg = habilesEntre(plan.inicioK, plan.ultimoSeg) + 1;
    const diasColaNuevas = habilesEntre(plan.inicioK, plan.ultimoNuevas) + 1;
    const hechas = Object.keys(llamadas).length; // llamadas, no OTST (un grupo = 1)
    const ent = entradasPromedio(reg.hist, filas);
    const segEq = cfg.cupoSegEquipo;

    // Alertas
    const alertas = [];
    const sobrecargados = Object.keys(plan.agenda).filter((k) => plan.agenda[k] > segEq).sort();
    if (nVenc) alertas.push(['rojo', `${nVenc} OTST vencidas. Con ${segEq} seguimientos por día, la cola de seguimiento llega hasta el <b>${corta(plan.ultimoSeg)}</b> (${diasColaSeg} días hábiles).`]);
    if (sobrecargados.length) alertas.push(['', `Días con más de ${segEq} llamadas agendadas en la intranet: ${sobrecargados.map((k) => `<b>${corta(k)}</b> (${plan.agenda[k]})`).join(', ')}. El excedente se corre al siguiente día con cupo.`]);
    if (ent.valor > capNuevasEquipo) alertas.push(['rojo', `Entran ~${ent.valor.toFixed(1)} OTST nuevas por día hábil${ent.estimado ? ' (estimado)' : ''} y ${activos.length > 1 ? 'el equipo alcanza' : 'alcanzas'} a llamar ${capNuevasEquipo} nuevas por día: la lista de nuevas va a crecer aunque se cumpla la meta.`]);
    if (diasColaNuevas > 1) alertas.push(['', `${plan.nuevas.length} OTST sin contacto: con ${capNuevasEquipo} por día se alcanzan a llamar todas en ${diasColaNuevas} días hábiles.`]);
    if (sync && remoto.ok === false) alertas.unshift(['rojo', `No se pudo sincronizar con el Sheet: ${esc(remoto.error)}. La agenda sigue funcionando sola en este navegador.`]);
    const viejas = filas.filter((f) => f.dias >= cfg.alertaSemanas * 7).sort((a, b) => b.dias - a.dias);
    if (viejas.length) alertas.push(['', `${viejas.length} OTST con más de ${cfg.alertaSemanas} semanas en este estado: ${viejas.slice(0, 6).map((f) => `<a href="/stecnico/item/${f.otst}" target="hpl_otst">${f.otst}</a> (${Math.floor(f.dias / 7)} sem)`).join(', ')}${viejas.length > 6 ? '…' : ''}. Considera cierre o disposición final.`]);
    const multis = Object.entries(porCliente).filter(([, l]) => l.length > 1);
    if (multis.length) alertas.push(['ok', `${multis.length} clientes tienen varias OTST abiertas (${multis.reduce((a, [, l]) => a + l.length, 0)} en total): revisa si el contacto es el mismo para resolverlas en una sola llamada.`]);
    if (!alertas.length) alertas.push(['ok', 'Todo al día: ninguna vencida ni día sobrecargado.']);

    // Gráfico de carga de los próximos días hábiles
    const dias = [];
    for (let d = deClave(plan.inicioK); dias.length < cfg.diasGrafico; d = sigHabil(d)) dias.push(clave(d));
    const maxY = Math.max(segEq + 2, ...dias.map((k) => Math.max(plan.carga[k] || 0, plan.agenda[k] || 0)));
    const alto = (n) => `${(n / maxY) * 100}%`;
    const barras = dias.map((k) => {
      const enDia = plan.seg.filter((f) => f.plan === k);
      const propias = enDia.filter((f) => f.fecha === k).length;
      const movidas = enDia.length - propias;
      const intr = plan.agenda[k] || 0;
      return `<div class="hpl-col" title="${corta(k)}: ${enDia.length} planeadas (${propias} agendadas para ese día, ${movidas} vencidas o corridas)${intr ? ` · ${intr} agendadas en la intranet` : ''}">
        ${intr > segEq ? `<span class="intr">${intr}⚠</span>` : ''}
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

    // Tabla de tu lista: llamadas hechas (✅) primero y luego las pendientes; las demás
    // OTST del mismo cliente van debajo (↳) y se registran con el mismo texto
    const orden = pestana === 'seg' ? listaSeg : listaNue;
    const multiOtsts = new Set(multis.flatMap(([, l]) => l));
    const etiquetaTipo = (tipo, fechaIni) => (tipo === 'vencida' ? `Vencida ${fechaIni ? corta(fechaIni) : ''}` : tipo === 'hoy' ? 'Hoy' : tipo === 'agendada' ? `Agendada ${fechaIni ? corta(fechaIni) : ''}` : 'Sin contacto');
    const resultado = (e) => (e.accion === 'efectiva' ? 'Contacto efectivo' : e.accion === 'reprogramada' ? `Reprogramada${e.fecha ? ' → ' + corta(e.fecha) : ''}` : 'Salió del estado');
    let n = 0;
    let filaN = 0;
    const filaHtml = (it, extraClase, accionHtml) => {
      const f = infoBase[it.otst];
      const cli = f ? f.cliente : (it.hecha && it.hecha.cliente) || '';
      const c = contactos[it.otst];
      const marca = it.hecha ? '✅' : it.sub ? '↳' : extraClase === 'tomada' ? '🔒' : ++n;
      return `<tr class="${extraClase}${it.sub ? ' sub' : ''}${!it.sub && filaN++ > 0 ? ' grupo' : ''}">
        <td class="ok">${marca}</td>
        <td><a href="/stecnico/item/${it.otst}" target="hpl_otst">${it.otst}</a></td>
        <td><span class="tag ${it.tipo}">${esc(etiquetaTipo(it.tipo, it.fechaIni))}</span>${f && f.garantia ? ' <span class="tag gar">Garantía</span>' : ''}${it.seg ? ' <span class="tag seg" title="La OTST de mayor número: aquí se deja el seguimiento; las demás se cierran">⭐ seguimiento</span>' : ''}</td>
        <td>${it.sub ? '<span class="mismo">mismo cliente</span>' : esc(cli)}${it.todas && !it.sub ? ` <span class="tag multi">${it.todas.length} OTST · 1 llamada</span>` : ''}
          ${multiOtsts.has(it.otst) && !it.hecha ? `<div class="contacto">${c ? (c.n ? '👤 ' + esc(c.n) : '👤 sin nombre') : '👤 consultando…'}</div>` : ''}</td>
        <td>${f ? esc(f.tiempo) : ''}</td>
        <td>${f ? esc(f.tecnico) : esc((it.hecha && it.hecha.tecnico) || '')}</td>
        <td>${accionHtml}</td>
      </tr>`;
    };
    // data-otsts: todas las OTST del cliente quedan "en llamada" para las demás personas
    const llamarHtml = (otst, texto, todas) => `<a class="llamar" data-otst="${otst}" data-otsts="${(todas || [otst]).join(',')}" href="/stecnico/item/${otst}/diagnosiscall" target="hpl_otst">${texto}</a>`;
    const accionDe = (it) => (it.hecha ? esc(resultado(it.hecha))
      : it.falta ? llamarHtml(it.otst, '📝 Falta registrar')
      : it.sub ? llamarHtml(it.otst, '📝 Registrar', it.todas)
      : llamarHtml(it.otst, '📞 Llamar', it.todas));
    let filasLista = orden.map((it) => filaHtml(it, it.hecha ? 'hecha' : '', accionDe(it))).join('');
    const otrosTab = enLlamadaOtros.filter((f) => (pestana === 'seg' ? f.tipo !== 'nueva' : f.tipo === 'nueva'));
    if (otrosTab.length) {
      filasLista += `<tr class="sep"><td colspan="7">En llamada por otras personas ahora</td></tr>` + otrosTab.map((f) => {
        const t = clienteTomado[f.cliente];
        return filaHtml({ otst: f.otst, tipo: f.tipo, fechaIni: f.fecha }, 'tomada',
          `<span class="quien">${esc(t.usuario)} · ${haceTexto(t.ts)}</span> ${llamarHtml(f.otst, 'Llamar igual')}`);
      }).join('');
    }

    // Chips "Mis técnicos" (los técnicos que hoy tienen OTST en la lista)
    const tecnicos = Object.entries(filas.reduce((a, f) => { if (f.tecnico) a[f.tecnico] = (a[f.tecnico] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]);
    const chipsTec = `<div class="hpl-tecs"><span class="t">Mis técnicos:</span>
      <button type="button" data-tec="" class="${filtroTec.length ? '' : 'act'}">Todos</button>
      ${tecnicos.map(([t, c]) => `<button type="button" data-tec="${esc(t)}" class="${filtroTec.includes(t) ? 'act' : ''}">${esc(t)} <small>${c}</small></button>`).join('')}
      ${sync ? '<span class="hpl-nota">Las demás personas ven tus OTST en llamada (🔒) y no las toman.</span>' : ''}</div>`;
    const equipoTxt = Object.keys(porPersona).length > 1 || (sync && activos.length > 1)
      ? `<div class="l">Equipo hoy: ${Object.entries(porPersona).map(([p, c]) => `${esc(p)} ${c}`).join(' · ') || '0'}</div>` : '';

    const sugerida = deClave(plan.sugerida);
    const html = `
      <div class="hpl-top">
        <h3>📞 ${ES_AGENDA ? 'Agenda de llamadas' : 'Planificador de llamadas'}</h3>
        <span class="hpl-sub">${esc(corta(plan.hoyK))}${yo ? ` · ${esc(yo)}` : ''} · tu cupo ${cfg.cupoTotal}/día (máx. ${cfg.cupoSeg} de seguimiento) · reprogramar: ${segEq} por día · fecha sugerida: <b>${pad(sugerida.getDate())}/${pad(sugerida.getMonth() + 1)}/${sugerida.getFullYear()}</b> · v${VERSION}</span>
        ${botonesTop()}
      </div>
      <div class="hpl-body">
        <div class="hpl-kpis">
          <div class="hpl-kpi ${hechas >= cfg.cupoTotal ? 'verde' : ''}"><div class="v">${hechas}/${cfg.cupoTotal}</div><div class="l">${sync ? 'Mis llamadas' : 'Llamadas'} hoy (${llamadasSeg.length} seguimiento · ${llamadasNue.length} nuevas)</div>${equipoTxt}<div class="hpl-barra"><i style="width:${Math.min(100, (hechas / cfg.cupoTotal) * 100)}%"></i></div></div>
          <div class="hpl-kpi ${nVenc ? 'rojo' : 'verde'}"><div class="v">${nVenc}</div><div class="l">Vencidas</div></div>
          <div class="hpl-kpi ${nHoy > segEq ? 'ambar' : ''}"><div class="v">${nHoy}</div><div class="l">Agendadas para hoy</div></div>
          <div class="hpl-kpi"><div class="v">${plan.nuevas.length}</div><div class="l">Sin contacto (nuevas)</div></div>
          <div class="hpl-kpi"><div class="v">${nAg}</div><div class="l">Agendadas a futuro</div></div>
          <div class="hpl-kpi ${diasColaSeg > 5 ? 'rojo' : diasColaSeg > 2 ? 'ambar' : 'verde'}"><div class="v">${diasColaSeg} d</div><div class="l">Cola de seguimiento (días hábiles, hasta ${corta(plan.ultimoSeg)})</div></div>
        </div>
        <ul class="hpl-alertas">${alertas.map(([c, t]) => `<li class="${c}">${t}</li>`).join('')}</ul>
        <div class="hpl-grid2">
          <div class="hpl-card">
            <h4>Carga de seguimiento — próximos ${cfg.diasGrafico} días hábiles</h4>
            <div class="hpl-chart">${barras}<div class="hpl-linea" style="bottom:${alto(segEq)}"><span>cupo ${segEq}</span></div></div>
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
            <button type="button" data-tab="seg" class="${pestana === 'seg' ? 'act' : ''}">Seguimiento de hoy (${llamadasSeg.length} hechas · cupo ${cfg.cupoSeg})</button>
            <button type="button" data-tab="nue" class="${pestana === 'nue' ? 'act' : ''}">Nuevas de hoy (${llamadasNue.length} hechas · cupo ${cupoNuevasTxt})</button>
          </div>
          ${chipsTec}
          <table class="hpl-lista">
            <tr><th>#</th><th>OTST</th><th>Tipo</th><th>Cliente</th><th>Tiempo</th><th>Técnico</th><th></th></tr>
            ${filasLista || `<tr><td colspan="7">${filtroTec.length ? 'No quedan OTST pendientes de tus técnicos en esta lista.' : 'No hay llamadas pendientes en esta lista.'}</td></tr>`}
          </table>
          <div class="hpl-nota">Tu lista toma los siguientes clientes libres de la cola hasta completar tu cupo: seguimiento, lo más atrasado primero; nuevas, la de mayor antigüedad primero. Un cliente con varias OTST es <b>una sola llamada</b>: sus demás OTST van debajo (↳) y ⭐ marca la mayor, donde se deja el seguimiento; las demás se cierran con el mismo texto (la Llamada de Seguimiento lo rellena). ✅ = registrada hoy${sync ? '; 🔒 = otra persona está llamando a ese cliente' : ''}.</div>
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
      <button type="button" data-act="cfg" title="Cambiar cupos">⚙️ Cupos</button>
      <button type="button" data-act="sync" title="Conectar con el Google Sheet (indicadores y llamar entre varias personas)">☁ Sheets</button>
      <span id="hpl-sync" class="hpl-sync"></span>`;
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
    const s = document.getElementById('hpl-sync');
    if (!s) return;
    if (!syncActivo()) { s.className = 'hpl-sync'; s.textContent = ''; s.title = ''; return; }
    const yo = syncCfg().usuario;
    const otros = Object.keys(remoto.activos || {}).filter((n) => n !== yo);
    if (remoto.ok === true) {
      s.className = 'hpl-sync ok';
      s.textContent = `🟢 ${otros.length ? 'En línea con ' + otros.join(', ') : 'En línea'}`;
      s.title = `Sincronizado con el Sheet ${haceTexto(remoto.ts)} como "${yo}"`;
    } else if (remoto.ok === false) {
      s.className = 'hpl-sync error'; s.textContent = '🔴 Sin Sheet'; s.title = remoto.error;
    } else { s.className = 'hpl-sync'; s.textContent = '⏳ Conectando…'; s.title = ''; }
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
    const lista = { fecha: clave(new Date()), items: ultimaLista };
    if (!lista.items.length) return;
    const info = {};
    datos.filas.forEach((f) => { info[f.otst] = f; });
    const fecha = (k) => (k ? k.split('-').reverse().join('/') : '');
    const tipo = { vencida: 'Vencida', hoy: 'Agendada hoy', agendada: 'Agendada', nueva: 'Sin contacto' };
    const q = (v) => (/[",;\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const filas = [['OTST', 'Cliente', 'Técnico Asignado', '¿En garantía?', 'Tipo', 'Fecha próximo contacto', 'Estado']];
    lista.items.forEach((it) => {
      const f = info[it.otst] || {};
      filas.push([it.otst, f.cliente || '', f.tecnico || '', f.garantia ? 'SI' : 'NO', tipo[it.tipo] || it.tipo, fecha(it.fechaIni), it.falta ? 'Falta registrar (grupo)' : it.hecha ? (it.hecha.accion === 'efectiva' ? 'Efectiva' : it.hecha.accion === 'reprogramada' ? `Reprogramada ${fecha(it.hecha.fecha)}`.trim() : 'Salió del estado') : 'Pendiente']);
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
    // Al abrir una llamada se avisa al Sheet para que nadie más la tome (sin frenar el enlace)
    const ll = e.target.closest('a.llamar[data-otst]');
    if (ll) { sincronizar({ tomar: (ll.dataset.otsts || ll.dataset.otst).split(',') }); return; }
    const b = e.target.closest('button, .hpl-top');
    if (!b) return;
    if (b.dataset.tab) { pestana = b.dataset.tab; render(); return; }
    if ('tec' in b.dataset) {
      const c = leer(K.cfg, {});
      const t = b.dataset.tec;
      let mis = Array.isArray(c.misTecnicos) ? c.misTecnicos : [];
      mis = !t ? [] : mis.includes(t) ? mis.filter((x) => x !== t) : [...mis, t];
      guardar(K.cfg, { ...c, misTecnicos: mis });
      render();
      sincronizar();
      return;
    }
    if (b.dataset.act === 'sync') { configurarSync(); return; }
    if (b.dataset.act === 'actualizar') { actualizarDesdeLibro(); return; }
    if (b.dataset.act === 'csv') { exportarCSV(); return; }
    if (b.dataset.act === 'cfg') {
      const cfg = { ...CFG_DEF, ...leer(K.cfg, {}) };
      const total = parseInt(prompt('TUS llamadas por día (cupo total de esta persona):', cfg.cupoTotal), 10);
      if (!total) return;
      const seg = parseInt(prompt('De esas, máximo de seguimientos (vencidas/reprogramadas) que haces tú por día:', cfg.cupoSeg), 10);
      if (isNaN(seg) || seg < 0) return;
      const eq = parseInt(prompt('Máximo de llamadas a reprogramar por día para TODO el equipo (lo que se agenda en la intranet):', cfg.cupoSegEquipo), 10);
      if (!eq) return;
      guardar(K.cfg, { ...leer(K.cfg, {}), cupoTotal: total, cupoSeg: Math.min(seg, total), cupoSegEquipo: eq });
      render();
      sincronizar();
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
  window.addEventListener('storage', (e) => {
    if (e.key !== K.log) return;
    if (datos.ts) render();
    sincronizar(); // envía al Sheet la llamada que se acaba de registrar
  });

  // Sincronización periódica con el Sheet (solo con la pestaña visible)
  function iniciarSync() {
    sincronizar();
    setInterval(() => { if (document.visibilityState === 'visible') sincronizar(); }, SYNC_CADA_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sincronizar(); });
  }

  function iniciarLibro() {
    const t = tablaLlamadas();
    if (!t) return false;
    estilos();
    // Los datos son del momento en que se pidió la página
    guardarLectura(leerFilas(t), Math.round(performance.timeOrigin || Date.now()));
    render();
    iniciarSync();
    return true;
  }

  function iniciarAgenda() {
    estilos();
    const g = leer(K.filas, null);
    if (g && Array.isArray(g.filas) && g.ts) datos = g;
    render();
    if (Date.now() - datos.ts > ACTUALIZAR_AL_VOLVER_MS) actualizarDesdeLibro();
    iniciarSync();
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

  localStorage.removeItem('hanna_pl_lista_hoy'); // lista congelada de v1.1 (ya no se usa)
  if (ES_AGENDA) iniciarAgenda();
  else if (!iniciarLibro()) {
    let intentos = 0;
    const id = setInterval(() => { if (iniciarLibro() || ++intentos > 20) clearInterval(id); }, 500);
  }
})();
