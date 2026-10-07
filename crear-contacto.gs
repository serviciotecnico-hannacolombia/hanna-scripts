/**
 * Crear contacto en Google Contacts desde la intranet (Hanna Colombia)
 * ====================================================================
 * Se publica como "Aplicación web" y lo llama el userscript
 * "contactos-google.user.js". Cada contacto se crea con:
 *   - Nombre    = nombre del contacto de la OT
 *   - Apellidos = nombre del cliente (empresa)
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

// ─────────────────────────────────────────────
// Puntos de entrada
// ─────────────────────────────────────────────
function doGet() {
  return respuestaJson_({ ok: true, mensaje: 'Servicio de contactos activo' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // evita duplicados si se hace doble clic
    var datos = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    var claveEsperada = PropertiesService.getScriptProperties().getProperty('CLAVE');
    if (!claveEsperada || datos.clave !== claveEsperada) {
      return respuestaJson_({ ok: false, error: 'Clave incorrecta' });
    }
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
  var correo = limpiar_(datos.correo).toLowerCase();
  var telefonos = (datos.telefonos || []).map(limpiar_).filter(Boolean);

  if (!nombre) return { ok: false, error: 'Falta el nombre del contacto' };
  if (!correo && telefonos.length === 0) {
    return { ok: false, error: 'El contacto no tiene correo ni teléfono' };
  }

  // 1) ¿Ya existe?
  var existente = buscarExistente_(correo, telefonos);
  if (existente) {
    return { ok: true, estado: 'existente', nombre: nombreDe_(existente) };
  }

  // 2) Crear
  var persona = { names: [{ givenName: nombre }] };
  if (empresa) {
    persona.names[0].familyName = empresa;
    persona.organizations = [{ name: empresa }];
  }
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

function buscarExistente_(correo, telefonos) {
  // searchContacts usa un caché: Google pide una primera llamada vacía
  // para "calentarlo". Si falla, se sigue igual.
  try {
    People.People.searchContacts({ query: '', readMask: 'names' });
  } catch (e) {}

  var consultas = [];
  if (correo) consultas.push(correo);
  telefonos.forEach(function (t) {
    var d = ultimos10_(t);
    if (d) consultas.push(d);
  });

  var telsBuscados = telefonos.map(ultimos10_).filter(Boolean);

  for (var i = 0; i < consultas.length; i++) {
    var resp;
    try {
      resp = People.People.searchContacts({
        query: consultas[i],
        readMask: 'names,emailAddresses,phoneNumbers',
        pageSize: 10
      });
    } catch (e) {
      Logger.log('Búsqueda falló (' + consultas[i] + '): ' + e);
      continue;
    }
    var resultados = (resp && resp.results) || [];
    for (var j = 0; j < resultados.length; j++) {
      var p = resultados[j].person || {};
      var coincideCorreo = correo && (p.emailAddresses || []).some(function (m) {
        return limpiar_(m.value).toLowerCase() === correo;
      });
      var coincideTel = telsBuscados.length && (p.phoneNumbers || []).some(function (t) {
        return telsBuscados.indexOf(ultimos10_(t.value)) !== -1;
      });
      if (coincideCorreo || coincideTel) return p;
    }
  }
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
