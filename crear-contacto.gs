/**
 * Crear contacto en Google Contacts desde la intranet (Hanna Colombia)
 * ====================================================================
 * Se publica como "Aplicación web" y lo llama el userscript
 * "contactos-google.user.js". Cada contacto se crea con:
 *   - Nombre    = nombre del contacto de la OT
 *   - Apellidos = por defecto el nombre del cliente (editable antes de enviar)
 *   - Empresa   = nombre del cliente
 *   - Correo y teléfono(s)
 *   - Etiqueta  = "Client"
 *   - Foto      = imagen aleatoria de Picsum
 *
 * Si ya existe un contacto con ese correo o teléfono, NO lo duplica ni lo
 * modifica: solo avisa que ya existía.
 *
 * PREPARACIÓN (una sola vez)
 *  1. En el editor de Apps Script: Servicios (+) -> "People API" -> Agregar.
 *  2. Configuración del proyecto -> Propiedades del script -> agregar
 *     CLAVE = una clave secreta larga que te inventes (la misma que luego
 *     pegas en el userscript). Sin esa clave nadie más puede crear contactos.
 *  3. Implementar -> Nueva implementación -> tipo "Aplicación web":
 *       Ejecutar como: Yo
 *       Quién tiene acceso: Cualquier usuario
 *     Copia la URL que termina en /exec.
 *  4. Cada vez que cambies este código: Implementar -> Administrar
 *     implementaciones -> editar -> Versión nueva (la URL no cambia).
 */

var ETIQUETA_CONTACTOS = 'Client';
var VERSION = '1.6'; // si abres la URL /exec en el navegador debe mostrar esta versión

// ─────────────────────────────────────────────
// Puntos de entrada
// ─────────────────────────────────────────────
function doGet() {
  return respuestaJson_({ ok: true, mensaje: 'Servicio de contactos activo', version: VERSION });
}

function doPost(e) {
  var datos;
  try {
    datos = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return respuestaJson_({ ok: false, error: 'Solicitud inválida' });
  }

  var claveEsperada = PropertiesService.getScriptProperties().getProperty('CLAVE');
  if (!claveEsperada || datos.clave !== claveEsperada) {
    return respuestaJson_({ ok: false, error: 'Clave incorrecta' });
  }

  // Consulta (solo lectura): ¿ya existe este contacto? No necesita bloqueo.
  if (datos.accion === 'consultar') {
    try {
      return respuestaJson_(consultarContacto_(datos));
    } catch (err) {
      return respuestaJson_({ ok: false, error: String(err) });
    }
  }

  // Creación
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // evita duplicados si se hace doble clic
    return respuestaJson_(crearContacto_(datos));
  } catch (err) {
    return respuestaJson_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function respuestaJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────
// Lógica principal
// ─────────────────────────────────────────────
function crearContacto_(datos) {
  // Regla general: nombre, apellido y empresa siempre en MAYÚSCULAS
  var nombre = limpiar_(datos.nombre).toLocaleUpperCase('es-CO');
  var empresa = limpiar_(datos.empresa).toLocaleUpperCase('es-CO');
  // Apellidos: si el userscript los manda (aunque sea vacíos) se respetan tal
  // cual; si no vienen (versión anterior del userscript) se usa la empresa.
  var apellidos = (datos.apellidos === undefined ? empresa : limpiar_(datos.apellidos).toLocaleUpperCase('es-CO'));
  var correo = limpiar_(datos.correo).toLowerCase();
  var telefonos = (datos.telefonos || []).map(limpiar_).filter(Boolean);

  if (!nombre) return { ok: false, error: 'Falta el nombre del contacto' };
  if (!correo && telefonos.length === 0) {
    return { ok: false, error: 'El contacto no tiene correo ni teléfono' };
  }

  // 1) ¿Ya existe? Cada teléfono es una persona distinta (el principal y sus
  // compañeros pueden compartir el mismo correo de autocompletado), así que
  // si hay teléfonos se compara SOLO por teléfono; el correo se usa
  // únicamente cuando el contacto no trae ningún teléfono.
  var existente = buscarExistente_(telefonos.length ? '' : correo, telefonos);
  if (existente) {
    return { ok: true, estado: 'existente', nombre: nombreDe_(existente) };
  }

  // 2) Crear
  var persona = { names: [{ givenName: nombre }] };
  if (apellidos) persona.names[0].familyName = apellidos;
  if (empresa) persona.organizations = [{ name: empresa }];
  if (correo) persona.emailAddresses = [{ value: correo }];
  if (telefonos.length) {
    persona.phoneNumbers = telefonos.map(function (t) { return { value: t }; });
  }
  var creado = People.People.createContact(persona);

  // 3) Etiqueta "Client" y foto: si alguna falla, el contacto ya quedó creado
  var etiquetaOk = true, fotoOk = true;
  try {
    var grupo = obtenerGrupo_(ETIQUETA_CONTACTOS);
    People.ContactGroups.Members.modify(
      { resourceNamesToAdd: [creado.resourceName] },
      grupo.resourceName
    );
  } catch (errG) {
    etiquetaOk = false;
    Logger.log('Etiqueta falló: ' + errG);
  }
  try {
    asignarFotoAleatoria_(creado.resourceName);
  } catch (errF) {
    fotoOk = false;
    Logger.log('Foto falló: ' + errF);
  }

  return { ok: true, estado: 'creado', nombre: nombre, etiqueta: etiquetaOk, foto: fotoOk };
}

// Solo consulta. Una única pasada por la lista de contactos que responde,
// POR CADA TELÉFONO recibido, si existe y con qué nombre está guardado. El
// correo se informa aparte (sirve para el número principal: si su teléfono no
// está pero el correo sí, la persona existe con otro número).
// Respuesta: { ok, version, resultados: [{telefono, existe, nombre}, ...],
//              correo: {existe, nombre} }   (resultados en el mismo orden)
function consultarContacto_(datos) {
  var correo = limpiar_(datos.correo).toLowerCase();
  var telefonos = (datos.telefonos || []).map(limpiar_).filter(Boolean);

  var resultados = telefonos.map(function (t) {
    return { telefono: t, clave: ultimos10_(t), existe: false, nombre: '' };
  });
  var resCorreo = { existe: false, nombre: '' };

  var pendientes = function () {
    var faltaTel = resultados.some(function (r) { return r.clave && !r.existe; });
    var faltaCorreo = correo && !resCorreo.existe;
    return faltaTel || faltaCorreo;
  };

  if (pendientes()) {
    var pageToken = null;
    do {
      var resp = People.People.Connections.list('people/me', {
        pageSize: 1000,
        personFields: 'names,emailAddresses,phoneNumbers',
        pageToken: pageToken || undefined
      });
      var personas = (resp && resp.connections) || [];
      for (var i = 0; i < personas.length; i++) {
        var p = personas[i];
        var nombre = nombreDe_(p);
        if (correo && !resCorreo.existe && (p.emailAddresses || []).some(function (m) {
          return limpiar_(m.value).toLowerCase() === correo;
        })) {
          resCorreo = { existe: true, nombre: nombre };
        }
        (p.phoneNumbers || []).forEach(function (tel) {
          var d = ultimos10_(tel.value);
          if (!d) return;
          resultados.forEach(function (r) {
            if (!r.existe && r.clave === d) { r.existe = true; r.nombre = nombre; }
          });
        });
      }
      pageToken = resp && resp.nextPageToken;
    } while (pageToken && pendientes()); // se detiene en cuanto todo quedó resuelto
  }

  return {
    ok: true,
    version: VERSION,
    resultados: resultados.map(function (r) {
      return { telefono: r.telefono, existe: r.existe, nombre: r.nombre };
    }),
    correo: resCorreo
  };
}

// ─────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────
function limpiar_(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

function soloDigitos_(v) {
  return String(v || '').replace(/\D/g, '');
}

// Compara teléfonos por sus últimos 10 dígitos (ignora +57, espacios, guiones)
function ultimos10_(v) {
  var d = soloDigitos_(v);
  return d.length > 10 ? d.slice(-10) : d;
}

function nombreDe_(persona) {
  return (persona.names && persona.names[0] && persona.names[0].displayName) || 'Contacto sin nombre';
}

// Busca comparando directamente contra la lista de contactos (no contra el
// índice de búsqueda de Google, que solo calza por prefijos y se actualiza
// con retraso). Compara el correo en minúsculas y los teléfonos por sus
// últimos 10 dígitos, sin importar espacios, guiones ni +57.
function buscarExistente_(correo, telefonos) {
  var telsBuscados = telefonos.map(ultimos10_).filter(Boolean);
  if (!correo && telsBuscados.length === 0) return null;

  var pageToken = null;
  do {
    var resp = People.People.Connections.list('people/me', {
      pageSize: 1000,
      personFields: 'names,emailAddresses,phoneNumbers',
      pageToken: pageToken || undefined
    });
    var personas = (resp && resp.connections) || [];
    for (var i = 0; i < personas.length; i++) {
      var p = personas[i];
      var coincideCorreo = correo && (p.emailAddresses || []).some(function (m) {
        return limpiar_(m.value).toLowerCase() === correo;
      });
      var coincideTel = telsBuscados.length && (p.phoneNumbers || []).some(function (t) {
        var d = ultimos10_(t.value);
        return d && telsBuscados.indexOf(d) !== -1;
      });
      if (coincideCorreo || coincideTel) return p;
    }
    pageToken = resp && resp.nextPageToken;
  } while (pageToken);
  return null;
}

function obtenerGrupo_(nombre) {
  var resp = People.ContactGroups.list({ pageSize: 200 });
  var grupos = resp.contactGroups || [];
  for (var i = 0; i < grupos.length; i++) {
    if (grupos[i].groupType === 'USER_CONTACT_GROUP' && grupos[i].name === nombre) {
      return grupos[i];
    }
  }
  return People.ContactGroups.create({ contactGroup: { name: nombre } });
}

function asignarFotoAleatoria_(resourceName) {
  // Parámetro único por contacto para que cada imagen sea distinta
  var url = 'https://picsum.photos/400?random=' + Utilities.getUuid();
  var respuesta = UrlFetchApp.fetch(url);
  var base64 = Utilities.base64Encode(respuesta.getBlob().getBytes());
  People.People.updateContactPhoto({ photoBytes: base64 }, resourceName);
}

// ─────────────────────────────────────────────
// Prueba manual desde el editor (opcional): ejecuta esta función y revisa
// el registro. Crea un contacto de prueba real, bórralo después.
// ─────────────────────────────────────────────
function pruebaManual() {
  var r = crearContacto_({
    nombre: 'PRUEBA CONTACTO',
    empresa: 'EMPRESA DE PRUEBA SAS',
    correo: 'prueba.contacto@example.com',
    telefonos: ['+573001234567']
  });
  Logger.log(JSON.stringify(r));
}