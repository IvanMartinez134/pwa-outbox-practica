// ---------------------------------------------------------------------------
// Mini-wrapper promisificado de IndexedDB (Vanilla JS)
// Se carga tanto en index.html como en sw.js mediante importScripts('./db-helper.js')
// ---------------------------------------------------------------------------

const DB_NAME = 'pwa-outbox-db';
const DB_VERSION = 1;
const STORE_NAME = 'transacciones_pendientes';

// --- Pieza 1: Apertura y migración de esquema ------------------------------
function abrirDB() {
  return new Promise((resolve, reject) => {
    const peticion = indexedDB.open(DB_NAME, DB_VERSION);

    // Se ejecuta solo si la BD es nueva o sube de versión
    peticion.onupgradeneeded = (evento) => {
      const db = evento.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    peticion.onsuccess = (evento) => resolve(evento.target.result);
    peticion.onerror = (evento) => reject(evento.target.error);
    peticion.onblocked = () => reject(new Error('La base de datos está bloqueada por otra pestaña.'));
  });
}

// --- Pieza 2: Escritura segura (CREATE) ------------------------------------
function guardarRegistro(datos) {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const peticion = store.add(datos);
      let idGenerado;

      peticion.onsuccess = (evento) => {
        idGenerado = evento.target.result;
      };

      // El dato no está garantizado en disco hasta que la transacción completa
      tx.oncomplete = () => resolve(idGenerado);
      tx.onerror = (evento) => reject(evento.target.error);
      tx.onabort = () => reject(new Error('La transacción de escritura fue abortada.'));
    });
  });
}

// --- Pieza 3: Lectura completa (READ) --------------------------------------
function obtenerTodosLosRegistros() {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const peticion = store.getAll();

      peticion.onsuccess = (evento) => resolve(evento.target.result);
      peticion.onerror = (evento) => reject(evento.target.error);
    });
  });
}

// --- Pieza 4: Eliminación por llave primaria (DELETE) ----------------------
function eliminarRegistro(id) {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);

      tx.oncomplete = () => resolve(true);
      tx.onerror = (evento) => reject(evento.target.error);
      tx.onabort = () => reject(new Error('La transacción de borrado fue abortada.'));
    });
  });
}

// --- Actualización de estado en una misma transacción (UPDATE) -------------
function actualizarEstadoRegistro(id, nuevoEstado) {
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      // 1. Obtener el registro actual por su llave primaria
      const peticionGet = store.get(id);
      peticionGet.onsuccess = (evento) => {
        const registro = evento.target.result;
        if (!registro) {
          reject(new Error('No se encontró el registro con ID: ' + id));
          return;
        }

        // 2. Modificar la propiedad y sobrescribir con .put()
        registro.estado = nuevoEstado;
        registro.fechaSincronizacion = Date.now();
        store.put(registro);
      };
      peticionGet.onerror = (evento) => reject(evento.target.error);

      // 3. Resolver la promesa cuando la transacción completa el guardado en disco
      tx.oncomplete = () => resolve(true);
      tx.onerror = (evento) => reject(evento.target.error);
      tx.onabort = () => reject(new Error('La transacción de actualización fue abortada.'));
    });
  });
}
