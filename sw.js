// ---------------------------------------------------------------------------
// Service Worker: App Shell, Background Sync y comunicación con la interfaz
// ---------------------------------------------------------------------------

// Importar el mini-wrapper de IndexedDB en el contexto del Service Worker
importScripts('./db-helper.js');

const ENDPOINT = 'https://jsonplaceholder.typicode.com/posts';

const CACHE_STATIC_NAME = 'static-outbox-v2';
const STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// --- Ciclo de vida: instalación del App Shell ------------------------------
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE_STATIC_NAME)
      .then((cache) => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nombres) => {
        return Promise.all(
          nombres
            .filter((nombre) => nombre.startsWith('static-outbox-') && nombre !== CACHE_STATIC_NAME)
            .map((nombre) => caches.delete(nombre))
        );
      })
      .then(() => self.clients.claim())
  );
});

// --- Estrategia de red: cache-first solo para el mismo origen -------------
self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;

  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;

  evento.respondWith(
    caches.match(peticion)
      .then((respuestaCache) => {
        if (respuestaCache) return respuestaCache;

        return fetch(peticion)
          .then((respuestaRed) => {
            if (respuestaRed && respuestaRed.status === 200) {
              const copia = respuestaRed.clone();
              caches.open(CACHE_STATIC_NAME)
                .then((cache) => cache.put(peticion, copia));
            }
            return respuestaRed;
          })
          .catch(() => {
            if (peticion.mode === 'navigate') {
              return caches.match('./index.html');
            }
            return caches.match('./');
          });
      })
  );
});

// --- Notificación del Worker hacia las pestañas abiertas ------------------
function notificarClientesActualizacion() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientes) => {
      clientes.forEach((cliente) => {
        cliente.postMessage({
          tipo: 'OUTBOX_SINCRONIZADO',
          timestamp: Date.now()
        });
      });
    });
}

// --- Motor de sincronización en segundo plano -----------------------------
function sincronizarPendientesSW() {
  console.log('[SW-Sync] Ejecutando barrido de transacciones pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[SW-Sync] Cola limpia. Nada por sincronizar.');
        return;
      }

      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: item.titulo,
            body: item.descripcion
          })
        })
          .then((respuesta) => {
            if (!respuesta.ok) {
              throw new Error('Error HTTP ' + respuesta.status + ' al sincronizar ID ' + item.id);
            }
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      return Promise.all(promesasDeEnvio)
        .then(() => notificarClientesActualizacion());
    });
}

// --- Escucha del evento sync ---------------------------------------------
self.addEventListener('sync', (evento) => {
  console.log('[SW-Sync] Evento sync disparado con etiqueta:', evento.tag);

  if (evento.tag === 'sync-reportes') {
    evento.waitUntil(
      sincronizarPendientesSW()
        .catch((error) => {
          console.error('[SW-Sync] Falla en sincronización; el navegador reintentará luego:', error);
          // Relanzar el error indica al navegador que debe programar un reintento automático
          throw error;
        })
    );
  }
});
