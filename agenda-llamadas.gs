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
 */

var VERSION = '1.1';
var ZONA = 'America/Bogota';
var TOMADA_MIN = 20;   // una OTST "en llamada" se libera sola a los 20 min
var ACTIVO_MIN = 30;   // personas conectadas en la última media hora

var H_BITACORA = 'Bitácora';
var H_RESUMEN = 'Resumen diario';
var H_INDICADORES = 'Indicadores';
var COLS_BITACORA = ['ID', 'Fecha y hora', 'Día', 'Usuario', 'OTST', 'Acción', 'Próximo contacto', 'Tipo', 'Cliente', 'Técnico', 'TS',
  'Grupo', 'Cuenta como llamada', 'OTST del grupo'];
var COLS_RESUMEN = ['Día', 'Actualizado', 'Reportado por', 'Pendientes', 'Vencidas', 'Para hoy', 'Agendadas', 'Sin contacto',
  'Entraron', 'Llamadas seguimiento', 'Llamadas nuevas', 'Salieron del estado', 'Días de cola seguimiento'];

// ─────────────────────────────────────────────
// Puntos de entrada
// ─────────────────────────────────────────────
function doGet() {
  return respuestaJson_({ ok: true, mensaje: 'Agenda de llamadas activa', version: VERSION });
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

  guardarEstado_(hoy, estado);
  return {
    ok: true, version: VERSION, recibidos: recibidos,
    bitacora: estado.bitacora, tomadas: estado.tomadas, activos: estado.activos,
  };
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
