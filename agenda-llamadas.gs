/**
 * Agenda de llamadas — base de datos en Google Sheets (Hanna Colombia)
 * ====================================================================
 * Lo usa "planificador-llamadas.user.js" (botón ☁ Sheets de la agenda) para:
 *   - Guardar cada llamada de seguimiento (hoja "Bitácora") con quién la hizo.
 *   - Guardar el estado de la cola cada día (hoja "Resumen diario").
 *   - Calcular indicadores con fórmulas (hoja "Indicadores").
 *   - Coordinar a varias personas llamando a la vez: cada agenda le pregunta
 *     a este script cada 20 s qué llamó el resto y qué OTST están "en llamada"
 *     (tomadas), para no llamar dos veces al mismo cliente.
 *
 * PREPARACIÓN (una sola vez)
 *  1. Crea un Google Sheet nuevo (p. ej. "Agenda de llamadas — Servicio Técnico").
 *  2. En el Sheet: Extensiones -> Apps Script. Borra lo que haya y pega este archivo.
 *  3. Configuración del proyecto (⚙) -> Propiedades del script -> agregar
 *     CLAVE = una clave secreta larga (la misma que cada persona pega en la agenda).
 *  4. En el editor elige la función "configurar" y dale ▶ Ejecutar (pide permisos
 *     la primera vez). Crea las hojas Bitácora, Resumen diario e Indicadores.
 *  5. Implementar -> Nueva implementación -> tipo "Aplicación web":
 *       Ejecutar como: Yo
 *       Quién tiene acceso: Cualquier usuario
 *     Copia la URL que termina en /exec.
 *  6. Cada persona, en la Agenda de llamadas: ☁ Sheets -> pega URL, CLAVE y su nombre.
 *  7. Si cambias este código: Implementar -> Administrar implementaciones ->
 *     editar -> Versión nueva (la URL no cambia).
 *
 * DATOS EN JSON PARA OTRO SISTEMA (opcional)
 *  Agrega la propiedad del script CLAVE_LECTURA (distinta de CLAVE: solo permite leer).
 *  URL: <url /exec>?clave=CLAVE_LECTURA&desde=2026-11-01&hasta=2026-11-30
 *  Opcional: &secciones=indicadores (o llamadas, resumen, prioritarias; separadas por coma).
 *  Sin desde/hasta: últimos 30 días. Google responde con una redirección: hay que seguirla.
 */

var VERSION = '1.3';
var ZONA = 'America/Bogota';
var TOMADA_MIN = 20;   // una OTST "en llamada" se libera sola a los 20 min
var ACTIVO_MIN = 30;   // personas conectadas en la última media hora
var META_DIA = 40;     // llamadas por persona al día
var TOPE_SEG = 10;     // llamadas de seguimiento (reprogramadas) por persona al día
var MAX_DIAS_JSON = 370;

var H_BITACORA = 'Bitácora';
var H_RESUMEN = 'Resumen diario';
var H_INDICADORES = 'Indicadores';
var COLS_BITACORA = ['ID', 'Fecha y hora', 'Día', 'Usuario', 'OTST', 'Acción', 'Próximo contacto', 'Tipo', 'Cliente', 'Técnico', 'TS',
  'Grupo', 'Cuenta como llamada', 'OTST del grupo'];
var H_PRIO = 'Prioritarias';
var COLS_PRIO = ['OTST', 'Nota', 'Marcada por', 'Marcada el', 'Cliente', 'Técnico', 'Garantía', 'Estado OTST', 'Estado',
  'Terminada por', 'Terminada el', 'TS'];
var COLS_RESUMEN = ['Día', 'Actualizado', 'Reportado por', 'Pendientes', 'Vencidas', 'Para hoy', 'Agendadas', 'Sin contacto',
  'Entraron', 'Llamadas seguimiento', 'Llamadas nuevas', 'Salieron del estado', 'Días de cola seguimiento'];

// ─────────────────────────────────────────────
// Puntos de entrada
// ─────────────────────────────────────────────
// GET sin parámetros: prueba de que está activo.
// GET ?clave=CLAVE_LECTURA&desde=yyyy-MM-dd&hasta=yyyy-MM-dd&secciones=llamadas,resumen,indicadores
//   -> datos en JSON para otro sistema (solo lectura). Ver datos_().
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!p.clave) return respuestaJson_({ ok: true, mensaje: 'Agenda de llamadas activa', version: VERSION });
  var claveLectura = PropertiesService.getScriptProperties().getProperty('CLAVE_LECTURA');
  if (!claveLectura) return respuestaJson_({ ok: false, error: 'Falta la propiedad del script CLAVE_LECTURA' });
  if (String(p.clave) !== claveLectura) return respuestaJson_({ ok: false, error: 'Clave incorrecta' });
  try {
    return respuestaJson_(datos_(p));
  } catch (err) {
    return respuestaJson_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  var datos;
  try {
    datos = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return respuestaJson_({ ok: false, error: 'Solicitud inválida' });
  }
  var claveEsperada = PropertiesService.getScriptProperties().getProperty('CLAVE');
  if (!claveEsperada || datos.clave !== claveEsperada) return respuestaJson_({ ok: false, error: 'Clave incorrecta' });
  var usuario = limpiar_(datos.usuario);
  if (!usuario) return respuestaJson_({ ok: false, error: 'Falta tu nombre (☁ Sheets en la agenda)' });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    return respuestaJson_(sincronizar_(datos, usuario));
  } catch (err) {
    return respuestaJson_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

// ─────────────────────────────────────────────
// Sincronización
// ─────────────────────────────────────────────
function sincronizar_(datos, usuario) {
  var ahora = Date.now();
  var hoy = dia_(ahora);
  var estado = leerEstado_(hoy);
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Llamadas nuevas -> Bitácora (sin duplicar por ID)
  // Llamada agrupada: varias OTST de un cliente con una sola llamada (columna Grupo = la
  // OTST donde se deja el seguimiento). Solo la primera fila del grupo cuenta como llamada.
  var recibidos = [];
  var filasNuevas = [];
  var gruposHoy = {};
  estado.bitacora.forEach(function (b) { if (b.grupo) gruposHoy[b.usuario + '|' + b.grupo + '|' + hoy] = 1; });
  (datos.llamadas || []).forEach(function (l) {
    var id = limpiar_(l.id);
    var otst = limpiar_(l.otst);
    var ts = Number(l.ts) || ahora;
    if (!id || !otst) return;
    recibidos.push(id);
    if (estado.ids[id]) return;
    estado.ids[id] = 1;
    var accion = l.accion === 'efectiva' ? 'efectiva' : l.accion === 'reprogramada' ? 'reprogramada' : limpiar_(l.accion);
    var grupo = limpiar_(l.grupo);
    var otsts = Array.isArray(l.otsts) ? l.otsts.map(limpiar_).filter(String).slice(0, 50) : [];
    var claveGrupo = usuario + '|' + grupo + '|' + dia_(ts);
    var cuenta = grupo && gruposHoy[claveGrupo] ? 0 : 1;
    if (grupo) gruposHoy[claveGrupo] = 1;
    filasNuevas.push([id, new Date(ts), dia_(ts), usuario, otst, accion, limpiar_(l.fecha), limpiar_(l.tipo),
      limpiar_(l.cliente), limpiar_(l.tecnico), ts, grupo, cuenta, otsts.join(', ')]);
    if (dia_(ts) === hoy) {
      estado.bitacora.push({ id: id, ts: ts, otst: otst, accion: accion, fecha: limpiar_(l.fecha), usuario: usuario, tipo: limpiar_(l.tipo), grupo: grupo, otsts: otsts });
    }
    delete estado.tomadas[otst]; // ya se llamó: se libera
  });
  if (filasNuevas.length) {
    var hb = hoja_(ss, H_BITACORA, COLS_BITACORA);
    hb.getRange(hb.getLastRow() + 1, 1, filasNuevas.length, COLS_BITACORA.length).setValues(filasNuevas);
  }

  // 2. OTST que alguien abrió para llamar ("en llamada"): una o todas las del cliente
  (Array.isArray(datos.tomar) ? datos.tomar : [datos.tomar]).map(limpiar_).filter(String).slice(0, 50).forEach(function (o) {
    var t = estado.tomadas[o];
    if (!t || t.usuario === usuario || ahora - t.ts > TOMADA_MIN * 60000) estado.tomadas[o] = { usuario: usuario, ts: ahora };
  });
  var soltar = limpiar_(datos.soltar);
  if (soltar && estado.tomadas[soltar] && estado.tomadas[soltar].usuario === usuario) delete estado.tomadas[soltar];
  Object.keys(estado.tomadas).forEach(function (o) {
    if (ahora - estado.tomadas[o].ts > TOMADA_MIN * 60000) delete estado.tomadas[o];
  });

  // 3. Personas conectadas y su cupo
  estado.activos[usuario] = {
    ts: ahora, cupoTotal: Number(datos.cupoTotal) || 0, cupoSeg: Number(datos.cupoSeg) || 0,
    tecnicos: Array.isArray(datos.tecnicos) ? datos.tecnicos.map(limpiar_).slice(0, 30) : [],
  };
  Object.keys(estado.activos).forEach(function (n) {
    if (ahora - estado.activos[n].ts > ACTIVO_MIN * 60000) delete estado.activos[n];
  });

  // 4. Resumen del día (estado de la cola)
  if (datos.resumen && datos.resumen.dia) guardarResumen_(ss, datos.resumen, usuario);

  // 5. OTST prioritarias (compartidas por todo el equipo)
  var prio = leerPrio_(ss);
  var prioOk = [];
  (Array.isArray(datos.prioridades) ? datos.prioridades : []).slice(0, 50).forEach(function (op) {
    var id = limpiar_(op && op.id);
    if (!id) return;
    prioOk.push(id);
    if (prio.ops[id]) return;
    prio.ops[id] = 1;
    aplicarOpPrio_(ss, prio, op, usuario, ahora);
  });
  // Una prioritaria se da por atendida cuando alguien registra una llamada de esa OTST
  filasNuevas.forEach(function (f) {
    var p = prio.lista[f[4]];
    if (p && p.estado === 'activa' && f[10] >= p.ts) terminarPrio_(ss, p, 'atendida', usuario, f[10]);
  });
  guardarPrio_(prio);

  guardarEstado_(hoy, estado);
  return {
    ok: true, version: VERSION, recibidos: recibidos,
    bitacora: estado.bitacora, tomadas: estado.tomadas, activos: estado.activos,
    prioridades: prioridadesVisibles_(prio, hoy), prioOk: prioOk,
  };
}

// ─────────────────────────────────────────────
// Prioritarias: hoja "Prioritarias" + caché { lista: { otst: {...} }, ops: { id: 1 } }
// ─────────────────────────────────────────────
function leerPrio_(ss) {
  var txt = CacheService.getScriptCache().get('prioridades');
  if (txt) {
    try { return JSON.parse(txt); } catch (e) {}
  }
  var prio = { lista: {}, ops: {} };
  var h = ss.getSheetByName(H_PRIO);
  if (h && h.getLastRow() > 1) {
    h.getRange(2, 1, h.getLastRow() - 1, COLS_PRIO.length).getValues().forEach(function (r, i) {
      var otst = String(r[0] || '');
      if (!otst) return;
      var finTs = r[10] instanceof Date ? r[10].getTime() : Number(r[10]) || 0;
      // Solo interesan las activas y las terminadas en los últimos 2 días
      if (String(r[8]) !== 'activa' && Date.now() - finTs > 2 * 864e5) { delete prio.lista[otst]; return; }
      prio.lista[otst] = { otst: otst, nota: String(r[1] || ''), por: String(r[2] || ''), ts: Number(r[11]) || (r[3] instanceof Date ? r[3].getTime() : 0),
        cliente: String(r[4] || ''), tecnico: String(r[5] || ''), garantia: String(r[6]) === 'SI', estadoOT: String(r[7] || ''),
        estado: String(r[8] || 'activa'), finPor: String(r[9] || ''), finTs: finTs, fila: i + 2 };
    });
  }
  return prio;
}

function guardarPrio_(prio) {
  var ids = Object.keys(prio.ops);
  if (ids.length > 500) ids.slice(0, ids.length - 300).forEach(function (k) { delete prio.ops[k]; });
  Object.keys(prio.lista).forEach(function (o) {
    var p = prio.lista[o];
    if (p.estado !== 'activa' && Date.now() - p.finTs > 2 * 864e5) delete prio.lista[o];
  });
  CacheService.getScriptCache().put('prioridades', JSON.stringify(prio), 21600);
}

function filaPrio_(p) {
  return [p.otst, p.nota, p.por, new Date(p.ts), p.cliente, p.tecnico, p.garantia ? 'SI' : 'NO', p.estadoOT, p.estado,
    p.finPor || '', p.finTs ? new Date(p.finTs) : '', p.ts];
}

function escribirPrio_(ss, p) {
  var h = hoja_(ss, H_PRIO, COLS_PRIO);
  // La fila guardada debe seguir siendo de esa OTST (por si alguien borró filas a mano)
  if (!p.fila || p.fila > h.getLastRow() || String(h.getRange(p.fila, 1).getValue()) !== p.otst) p.fila = h.getLastRow() + 1;
  h.getRange(p.fila, 1, 1, COLS_PRIO.length).setValues([filaPrio_(p)]);
}

function aplicarOpPrio_(ss, prio, op, usuario, ahora) {
  var otst = limpiar_(op.otst).replace(/\D/g, '');
  if (!otst) return;
  var p = prio.lista[otst];
  if (op.op === 'quitar') {
    if (p && p.estado === 'activa') terminarPrio_(ss, p, 'quitada', usuario, ahora);
    return;
  }
  if (op.op !== 'marcar') return;
  var nueva = !p || p.estado !== 'activa';
  p = { otst: otst, nota: limpiar_(op.nota), por: nueva ? usuario : p.por, ts: nueva ? Number(op.ts) || ahora : p.ts,
    cliente: limpiar_(op.cliente) || (p && p.cliente) || '', tecnico: limpiar_(op.tecnico) || (p && p.tecnico) || '',
    garantia: op.garantia === true || (!op.cliente && !!(p && p.garantia)), estadoOT: limpiar_(op.estadoOT) || (p && p.estadoOT) || '',
    estado: 'activa', finPor: '', finTs: 0, fila: nueva ? 0 : p.fila };
  prio.lista[otst] = p;
  escribirPrio_(ss, p);
}

function terminarPrio_(ss, p, estado, usuario, ts) {
  p.estado = estado; p.finPor = usuario; p.finTs = ts;
  escribirPrio_(ss, p);
}

// Activas + terminadas hoy (para mostrarlas con ✅ el resto del día)
function prioridadesVisibles_(prio, hoy) {
  return Object.keys(prio.lista).map(function (o) { return prio.lista[o]; })
    .filter(function (p) { return p.estado === 'activa' || (p.finTs && dia_(p.finTs) === hoy); })
    .map(function (p) {
      return { otst: p.otst, nota: p.nota, por: p.por, ts: p.ts, cliente: p.cliente, tecnico: p.tecnico, garantia: p.garantia,
        estadoOT: p.estadoOT, estado: p.estado, finPor: p.finPor, finTs: p.finTs };
    });
}

// Estado del día en caché (rápido). Si se pierde, se reconstruye la bitácora desde la hoja.
function leerEstado_(hoy) {
  var cache = CacheService.getScriptCache();
  var txt = cache.get('estado_' + hoy);
  if (txt) {
    try { return JSON.parse(txt); } catch (e) {}
  }
  var estado = { bitacora: [], tomadas: {}, activos: {}, ids: {} };
  var hb = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(H_BITACORA);
  if (hb && hb.getLastRow() > 1) {
    var desde = Math.max(2, hb.getLastRow() - 3000 + 1); // basta con las últimas filas
    var filas = hb.getRange(desde, 1, hb.getLastRow() - desde + 1, COLS_BITACORA.length).getValues();
    filas.forEach(function (r) {
      var id = String(r[0]);
      if (!id) return;
      estado.ids[id] = 1;
      var diaFila = r[2] instanceof Date ? Utilities.formatDate(r[2], ZONA, 'yyyy-MM-dd') : String(r[2]);
      if (diaFila !== hoy) return;
      var ts = Number(r[10]) || (r[1] instanceof Date ? r[1].getTime() : 0);
      var fecha = r[6] instanceof Date ? Utilities.formatDate(r[6], ZONA, 'yyyy-MM-dd') : String(r[6] || '');
      var otstsG = String(r[13] || '').split(/\s*,\s*/).filter(String);
      estado.bitacora.push({ id: id, ts: ts, otst: String(r[4]), accion: String(r[5]), fecha: fecha, usuario: String(r[3]), tipo: String(r[7]), grupo: String(r[11] || ''), otsts: otstsG });
    });
  }
  return estado;
}

function soloDeHoy_(estado) {
  var ids = {};
  estado.bitacora.forEach(function (b) { ids[b.id] = 1; });
  return ids;
}

function guardarEstado_(hoy, estado) {
  // Los IDs de días anteriores no hacen falta en caché (el userscript solo reenvía lo no confirmado)
  if (Object.keys(estado.ids).length > 800) estado.ids = soloDeHoy_(estado);
  CacheService.getScriptCache().put('estado_' + hoy, JSON.stringify(estado), 21600);
}

function guardarResumen_(ss, r, usuario) {
  var hr = hoja_(ss, H_RESUMEN, COLS_RESUMEN);
  var fila = [limpiar_(r.dia), new Date(), usuario, num_(r.total), num_(r.vencidas), num_(r.hoy), num_(r.agendadas),
    num_(r.sinContacto), num_(r.entradas), num_(r.hechasSeg), num_(r.hechasNuevas), num_(r.cerradas), num_(r.colaDias)];
  var ultima = hr.getLastRow();
  if (ultima > 1) {
    // Se actualiza la fila del día (buscando desde el final)
    var dias = hr.getRange(Math.max(2, ultima - 30), 1, ultima - Math.max(2, ultima - 30) + 1, 1).getValues();
    for (var i = dias.length - 1; i >= 0; i--) {
      var d = dias[i][0] instanceof Date ? Utilities.formatDate(dias[i][0], ZONA, 'yyyy-MM-dd') : String(dias[i][0]);
      if (d === fila[0]) {
        hr.getRange(Math.max(2, ultima - 30) + i, 1, 1, fila.length).setValues([fila]);
        return;
      }
    }
  }
  hr.getRange(ultima + 1, 1, 1, fila.length).setValues([fila]);
}

// ─────────────────────────────────────────────
// Datos en JSON (doGet con CLAVE_LECTURA)
// ─────────────────────────────────────────────
// "efectiva" = se cerró el seguimiento (contacto efectivo); "reprogramada" = quedó otra
// llamada agendada. Una "llamada" es una fila con "Cuenta como llamada" = 1 (un cliente
// con varias OTST agrupadas = 1 llamada); "registros" son las OTST registradas.
function datos_(p) {
  var hoy = dia_(Date.now());
  var hasta = /^\d{4}-\d{2}-\d{2}$/.test(p.hasta || '') ? p.hasta : hoy;
  var desde = /^\d{4}-\d{2}-\d{2}$/.test(p.desde || '') ? p.desde : sumarDias_(hasta, -29);
  if (desde > hasta) { var t = desde; desde = hasta; hasta = t; }
  if (difDias_(desde, hasta) > MAX_DIAS_JSON) desde = sumarDias_(hasta, -MAX_DIAS_JSON);
  var secciones = String(p.secciones || 'llamadas,resumen,indicadores,prioritarias').toLowerCase();
  var quiere = function (s) { return secciones.indexOf(s) >= 0; };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var todas = leerBitacora_(ss, hasta); // hasta "hasta" (para intentos y fechas hace falta lo anterior)
  var enRango = todas.filter(function (l) { return l.dia >= desde; });
  var resumen = leerResumen_(ss, desde, hasta);

  var r = { ok: true, version: VERSION, generado: new Date().toISOString(), zona: ZONA, desde: desde, hasta: hasta,
    meta: { llamadasPorDia: META_DIA, topeSeguimientoPorDia: TOPE_SEG } };
  if (quiere('llamadas')) r.llamadas = enRango.map(function (l) {
    return { id: l.id, fecha: l.fecha, dia: l.dia, hora: l.hora, usuario: l.usuario, otst: l.otst, accion: l.accion,
      proximo: l.proximo, tipo: l.tipo, seguimiento: l.seguimiento, cliente: l.cliente, tecnico: l.tecnico,
      grupo: l.grupo, cuenta: l.cuenta, otsts: l.otsts };
  });
  if (quiere('resumen')) r.resumen = resumen;
  if (quiere('prioritarias')) r.prioritarias = leerPrioritarias_(ss, desde, hasta);
  if (quiere('indicadores')) r.indicadores = indicadores_(todas, enRango, resumen, desde, hasta);
  return r;
}

function leerBitacora_(ss, hasta) {
  var hb = ss.getSheetByName(H_BITACORA);
  if (!hb || hb.getLastRow() < 2) return [];
  var filas = hb.getRange(2, 1, hb.getLastRow() - 1, COLS_BITACORA.length).getValues();
  var out = [];
  filas.forEach(function (r) {
    if (!r[0] || !r[4]) return;
    var ts = Number(r[10]) || (r[1] instanceof Date ? r[1].getTime() : 0);
    var dia = diaTxt_(r[2]) || (ts ? dia_(ts) : '');
    if (!dia || dia > hasta) return;
    var tipo = String(r[7] || '');
    out.push({
      id: String(r[0]), ts: ts, fecha: ts ? Utilities.formatDate(new Date(ts), ZONA, "yyyy-MM-dd'T'HH:mm:ssXXX") : '',
      dia: dia, hora: ts ? Number(Utilities.formatDate(new Date(ts), ZONA, 'H')) : null,
      usuario: String(r[3] || ''), otst: String(r[4]), accion: String(r[5] || ''), proximo: diaTxt_(r[6]),
      tipo: tipo, seguimiento: tipo !== '' && tipo !== 'nueva', cliente: String(r[8] || ''), tecnico: String(r[9] || ''),
      grupo: String(r[11] || ''), cuenta: r[12] === '' || r[12] === null ? 1 : Number(r[12]) || 0,
      otsts: String(r[13] || '').split(/\s*,\s*/).filter(String),
    });
  });
  out.sort(function (a, b) { return a.ts - b.ts; });
  return out;
}

// Prioritarias marcadas en el rango, con horas hasta que se atendieron
function leerPrioritarias_(ss, desde, hasta) {
  var h = ss.getSheetByName(H_PRIO);
  if (!h || h.getLastRow() < 2) return [];
  return h.getRange(2, 1, h.getLastRow() - 1, COLS_PRIO.length).getValues()
    .map(function (r) {
      var ts = Number(r[11]) || (r[3] instanceof Date ? r[3].getTime() : 0);
      var fin = r[10] instanceof Date ? r[10].getTime() : 0;
      return { otst: String(r[0] || ''), nota: String(r[1] || ''), marcadaPor: String(r[2] || ''), marcada: ts ? dia_(ts) : '',
        cliente: String(r[4] || ''), tecnico: String(r[5] || ''), garantia: String(r[6]) === 'SI', estadoOT: String(r[7] || ''),
        estado: String(r[8] || ''), terminadaPor: String(r[9] || ''), terminada: fin ? dia_(fin) : '',
        horasHastaAtender: String(r[8]) === 'atendida' && fin && ts ? Math.round(((fin - ts) / 36e5) * 10) / 10 : null };
    })
    .filter(function (p) { return p.otst && p.marcada >= desde && p.marcada <= hasta; });
}

function leerResumen_(ss, desde, hasta) {
  var hr = ss.getSheetByName(H_RESUMEN);
  if (!hr || hr.getLastRow() < 2) return [];
  return hr.getRange(2, 1, hr.getLastRow() - 1, COLS_RESUMEN.length).getValues()
    .map(function (r) {
      var n = function (v) { return v === '' || v === null ? null : Number(v); };
      return { dia: diaTxt_(r[0]), reportadoPor: String(r[2] || ''), pendientes: n(r[3]), vencidas: n(r[4]), paraHoy: n(r[5]),
        agendadas: n(r[6]), sinContacto: n(r[7]), entraron: n(r[8]), llamadasSeguimiento: n(r[9]), llamadasNuevas: n(r[10]),
        salieron: n(r[11]), diasColaSeguimiento: n(r[12]),
        flujoNeto: r[8] === '' || r[11] === '' ? null : Number(r[8]) - Number(r[11]) };
    })
    .filter(function (x) { return x.dia && x.dia >= desde && x.dia <= hasta; })
    .sort(function (a, b) { return a.dia < b.dia ? -1 : 1; });
}

function indicadores_(todas, enRango, resumen, desde, hasta) {
  var pct = function (a, b) { return b ? Math.round((a / b) * 1000) / 10 : null; };
  var red = function (v) { return v === null || isNaN(v) ? null : Math.round(v * 100) / 100; };
  var cuenta = function (lista, f) { return lista.filter(f).length; };
  var efectiva = function (l) { return l.accion === 'efectiva'; };
  var reprog = function (l) { return l.accion === 'reprogramada'; };
  var esLlamada = function (l) { return l.cuenta === 1; };

  // 1. Por día y persona vs meta
  var dp = {};
  enRango.forEach(function (l) {
    var k = l.dia + '|' + l.usuario;
    var x = dp[k] || (dp[k] = { dia: l.dia, usuario: l.usuario, llamadas: 0, otst: 0, efectivas: 0, reprogramadas: 0,
      llamadasSeguimiento: 0, llamadasNuevas: 0 });
    x.otst++;
    if (efectiva(l)) x.efectivas++;
    if (reprog(l)) x.reprogramadas++;
    if (esLlamada(l)) { x.llamadas++; if (l.seguimiento) x.llamadasSeguimiento++; else x.llamadasNuevas++; }
  });
  var porDiaPersona = Object.keys(dp).sort().map(function (k) {
    var x = dp[k];
    x.cumplimientoMeta = pct(x.llamadas, META_DIA);
    x.superaTopeSeguimiento = x.llamadasSeguimiento > TOPE_SEG;
    return x;
  });

  // 2. Por persona en el periodo
  var pp = {};
  porDiaPersona.forEach(function (x) {
    var y = pp[x.usuario] || (pp[x.usuario] = { usuario: x.usuario, dias: 0, llamadas: 0, otst: 0, efectivas: 0, reprogramadas: 0,
      diasEnMeta: 0, diasSobreTopeSeguimiento: 0 });
    y.dias++; y.llamadas += x.llamadas; y.otst += x.otst; y.efectivas += x.efectivas; y.reprogramadas += x.reprogramadas;
    if (x.llamadas >= META_DIA) y.diasEnMeta++;
    if (x.superaTopeSeguimiento) y.diasSobreTopeSeguimiento++;
  });
  var porPersona = Object.keys(pp).sort().map(function (k) {
    var y = pp[k];
    y.promedioLlamadasDia = red(y.llamadas / y.dias);
    y.cumplimientoMeta = pct(y.llamadas, y.dias * META_DIA);
    y.pctEfectivas = pct(y.efectivas, y.otst);
    return y;
  });

  // 3. Intentos hasta cierre y cumplimiento de la fecha agendada (con la historia anterior al rango)
  var intentos = {}, pendiente = {}, cierres = [];
  var fechas = { evaluadas: 0, aTiempo: 0, antes: 0, tarde: 0, sumaAtraso: 0, maxAtraso: 0 };
  todas.forEach(function (l) {
    var prev = pendiente[l.otst];
    if (prev && prev.proximo && l.dia >= desde) {
      var atraso = difDias_(prev.proximo, l.dia);
      fechas.evaluadas++;
      if (atraso === 0) fechas.aTiempo++;
      else if (atraso < 0) fechas.antes++;
      else { fechas.tarde++; fechas.sumaAtraso += atraso; fechas.maxAtraso = Math.max(fechas.maxAtraso, atraso); }
    }
    intentos[l.otst] = (intentos[l.otst] || 0) + 1;
    if (efectiva(l)) {
      if (l.dia >= desde) cierres.push({ otst: l.otst, cliente: l.cliente, tecnico: l.tecnico, intentos: intentos[l.otst], dia: l.dia });
      intentos[l.otst] = 0;
      delete pendiente[l.otst];
    } else {
      pendiente[l.otst] = l;
    }
  });
  var dist = { '1': 0, '2': 0, '3': 0, '4+': 0 };
  cierres.forEach(function (c) { dist[c.intentos >= 4 ? '4+' : String(c.intentos)]++; });
  var abiertasConMasIntentos = Object.keys(pendiente)
    .filter(function (o) { return intentos[o] >= 3; })
    .map(function (o) { var l = pendiente[o]; return { otst: o, cliente: l.cliente, tecnico: l.tecnico, intentos: intentos[o], ultimoIntento: l.dia, proximo: l.proximo }; })
    .sort(function (a, b) { return b.intentos - a.intentos; }).slice(0, 30);

  // 4. Por técnico y por cliente
  var agrupar = function (campo) {
    var m = {};
    enRango.forEach(function (l) {
      var k = l[campo] || '(sin dato)';
      var x = m[k] || (m[k] = { nombre: k, otst: {}, registros: 0, llamadas: 0, efectivas: 0, reprogramadas: 0, grupos: {} });
      x.otst[l.otst] = 1; x.registros++;
      if (esLlamada(l)) x.llamadas++;
      if (efectiva(l)) x.efectivas++;
      if (reprog(l)) x.reprogramadas++;
      if (l.grupo) x.grupos[l.grupo] = 1;
    });
    return Object.keys(m).map(function (k) {
      var x = m[k];
      return { nombre: x.nombre, otstDistintas: Object.keys(x.otst).length, registros: x.registros, llamadas: x.llamadas,
        efectivas: x.efectivas, reprogramadas: x.reprogramadas, pctEfectivas: pct(x.efectivas, x.registros),
        intentosPorOtst: red(x.registros / Object.keys(x.otst).length), gruposAgrupados: Object.keys(x.grupos).length };
    }).sort(function (a, b) { return b.otstDistintas - a.otstDistintas || b.registros - a.registros; });
  };

  // 5. Por hora del día
  var ph = {};
  enRango.forEach(function (l) {
    if (l.hora === null) return;
    var x = ph[l.hora] || (ph[l.hora] = { hora: l.hora, registros: 0, llamadas: 0, efectivas: 0 });
    x.registros++;
    if (esLlamada(l)) x.llamadas++;
    if (efectiva(l)) x.efectivas++;
  });
  var porHora = Object.keys(ph).map(function (k) { var x = ph[k]; x.pctEfectivas = pct(x.efectivas, x.registros); return x; })
    .sort(function (a, b) { return a.hora - b.hora; });

  // 6. Cola (Resumen diario)
  var conDato = function (campo) { return resumen.filter(function (x) { return x[campo] !== null; }); };
  var prom = function (campo) { var l = conDato(campo); return l.length ? red(l.reduce(function (s, x) { return s + x[campo]; }, 0) / l.length) : null; };
  var suma = function (campo) { return conDato(campo).reduce(function (s, x) { return s + x[campo]; }, 0); };
  var primero = resumen[0], ultimo = resumen[resumen.length - 1];

  var llamadas = cuenta(enRango, esLlamada);
  var efectivas = cuenta(enRango, efectiva);
  var reprogramadas = cuenta(enRango, reprog);
  var dias = {};
  enRango.forEach(function (l) { dias[l.dia] = 1; });
  return {
    totales: {
      diasConLlamadas: Object.keys(dias).length, personas: porPersona.length,
      llamadas: llamadas, otstRegistradas: enRango.length, otstDistintas: Object.keys(enRango.reduce(function (m, l) { m[l.otst] = 1; return m; }, {})).length,
      llamadasSeguimiento: cuenta(enRango, function (l) { return esLlamada(l) && l.seguimiento; }),
      llamadasNuevas: cuenta(enRango, function (l) { return esLlamada(l) && !l.seguimiento; }),
      efectivas: efectivas, reprogramadas: reprogramadas, otrasAcciones: enRango.length - efectivas - reprogramadas,
      pctEfectivas: pct(efectivas, enRango.length), pctReprogramadas: pct(reprogramadas, enRango.length),
      otstPorLlamada: red(llamadas ? enRango.length / llamadas : null),
      llamadasAhorradasPorAgrupacion: enRango.length - llamadas,
    },
    porDiaPersona: porDiaPersona,
    porPersona: porPersona,
    intentosHastaCierre: {
      cierres: cierres.length,
      promedio: red(cierres.length ? cierres.reduce(function (s, c) { return s + c.intentos; }, 0) / cierres.length : null),
      distribucion: dist,
      cierresDificiles: cierres.filter(function (c) { return c.intentos >= 4; }).sort(function (a, b) { return b.intentos - a.intentos; }).slice(0, 30),
      abiertasConMasIntentos: abiertasConMasIntentos,
    },
    cumplimientoFecha: {
      evaluadas: fechas.evaluadas, enLaFecha: fechas.aTiempo, antes: fechas.antes, tarde: fechas.tarde,
      pctATiempo: pct(fechas.aTiempo + fechas.antes, fechas.evaluadas),
      promedioDiasAtraso: red(fechas.tarde ? fechas.sumaAtraso / fechas.tarde : null), maxDiasAtraso: fechas.maxAtraso,
    },
    cola: {
      dias: resumen.length,
      pendientesInicio: primero ? primero.pendientes : null, pendientesFin: ultimo ? ultimo.pendientes : null,
      vencidasFin: ultimo ? ultimo.vencidas : null, promedioVencidas: prom('vencidas'),
      entraron: suma('entraron'), salieron: suma('salieron'), flujoNeto: suma('entraron') - suma('salieron'),
      diasColaSeguimientoFin: ultimo ? ultimo.diasColaSeguimiento : null, promedioDiasColaSeguimiento: prom('diasColaSeguimiento'),
    },
    porTecnico: agrupar('tecnico'),
    porCliente: agrupar('cliente').slice(0, 50),
    porHora: porHora,
  };
}

function diaTxt_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ZONA, 'yyyy-MM-dd');
  var s = String(v || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // dd/MM/yyyy
  return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : '';
}

function difDias_(a, b) { // días de a hasta b (yyyy-MM-dd)
  var u = function (s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); };
  return Math.round((u(b) - u(a)) / 86400000);
}

function sumarDias_(s, n) {
  var p = s.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────
// Configuración del Sheet (ejecutar una vez desde el editor)
// ─────────────────────────────────────────────
function configurar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hb = hoja_(ss, H_BITACORA, COLS_BITACORA);
  hb.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm');
  hb.getRange('C:C').setNumberFormat('@');
  hb.getRange('E:E').setNumberFormat('@');
  hb.getRange('G:G').setNumberFormat('@');
  hb.hideColumns(1);
  hb.hideColumns(11);
  // Filas de antes de la versión 1.1 (sin "Cuenta como llamada"): cada una era una llamada
  if (hb.getLastRow() > 1) {
    var rango = hb.getRange(2, 13, hb.getLastRow() - 1, 1);
    rango.setValues(rango.getValues().map(function (v) { return [v[0] === '' ? 1 : v[0]]; }));
  }

  var hp = hoja_(ss, H_PRIO, COLS_PRIO);
  hp.getRange('A:A').setNumberFormat('@');
  hp.getRange('D:D').setNumberFormat('dd/MM/yyyy HH:mm');
  hp.getRange('K:K').setNumberFormat('dd/MM/yyyy HH:mm');
  hp.hideColumns(12);

  var hr = hoja_(ss, H_RESUMEN, COLS_RESUMEN);
  hr.getRange('A:A').setNumberFormat('@');
  hr.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm');

  var hi = ss.getSheetByName(H_INDICADORES) || ss.insertSheet(H_INDICADORES);
  hi.clear();
  hi.getCharts().forEach(function (c) { hi.removeChart(c); });
  var B = "'" + H_BITACORA + "'!A:N";
  var bloques = [
    ['A1', 'Llamadas por día y persona (un cliente con varias OTST = 1 llamada)',
      '=IFERROR(QUERY(' + B + ',"select C, sum(M) where C is not null group by C pivot D order by C desc label C \'Día\'",1),"Sin datos aún")'],
    ['K1', 'OTST registradas por día y persona',
      '=IFERROR(QUERY(' + B + ',"select C, count(E) where C is not null group by C pivot D order by C desc label C \'Día\'",1),"Sin datos aún")'],
    ['A30', 'Resultado por persona (todas las fechas)',
      '=IFERROR(QUERY(' + B + ',"select D, count(E) where D is not null group by D pivot F label D \'Usuario\'",1),"Sin datos aún")'],
    ['F30', 'OTST por tipo y día',
      '=IFERROR(QUERY(' + B + ',"select C, count(E) where C is not null group by C pivot H order by C desc label C \'Día\'",1),"Sin datos aún")'],
    ['A60', 'Resultado por técnico asignado',
      '=IFERROR(QUERY(' + B + ',"select J, count(E) where J is not null group by J pivot F label J \'Técnico\'",1),"Sin datos aún")'],
    ['F60', 'OTST con más intentos de llamada',
      '=IFERROR(QUERY(' + B + ',"select E, I, count(F), max(B) where E is not null group by E, I order by count(F) desc limit 30 label E \'OTST\', I \'Cliente\', count(F) \'Intentos\', max(B) \'Último intento\'",1),"Sin datos aún")'],
  ];
  bloques.forEach(function (b) {
    var celda = hi.getRange(b[0]);
    celda.setValue(b[1]).setFontWeight('bold').setFontColor('#0b3d78');
    celda.offset(1, 0).setFormula(b[2]);
  });

  // Gráfico de la cola en la hoja Resumen diario
  hr.getCharts().forEach(function (c) { hr.removeChart(c); });
  var grafico = hr.newChart().asLineChart()
    .addRange(hr.getRange('A1:A400'))
    .addRange(hr.getRange('D1:E400'))
    .addRange(hr.getRange('H1:H400'))
    .setNumHeaders(1)
    .setOption('title', 'Cola de llamadas de seguimiento')
    .setOption('legend', { position: 'bottom' })
    .setPosition(2, COLS_RESUMEN.length + 2, 0, 0)
    .build();
  hr.insertChart(grafico);

  var hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hoja1 && ss.getSheets().length > 1 && hoja1.getLastRow() === 0) ss.deleteSheet(hoja1);
  ss.setActiveSheet(hi);
  return 'Listo: hojas creadas. Ahora Implementar -> Nueva implementación -> Aplicación web.';
}

// ─────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────
function hoja_(ss, nombre, columnas) {
  var h = ss.getSheetByName(nombre);
  if (!h) h = ss.insertSheet(nombre);
  // Hoja nueva, o creada con una versión anterior que tenía menos columnas
  if (h.getLastRow() === 0 || h.getLastColumn() < columnas.length) {
    h.getRange(1, 1, 1, columnas.length).setValues([columnas]).setFontWeight('bold').setBackground('#e6f0fb');
    h.setFrozenRows(1);
  }
  return h;
}

function dia_(ts) {
  return Utilities.formatDate(new Date(ts), ZONA, 'yyyy-MM-dd');
}

function num_(v) {
  return v === null || v === undefined || v === '' || isNaN(Number(v)) ? '' : Number(v);
}

function limpiar_(v) {
  return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, 200);
}

function respuestaJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
