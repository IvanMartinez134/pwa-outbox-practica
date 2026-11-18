// ---------------------------------------------------------------------------
// Lógica de interfaz, envío resiliente y reconexión
// Requiere db-helper.js cargado previamente en index.html
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://jsonplaceholder.typicode.com/posts';

// --- Puente de comunicación: mensajes provenientes del Service Worker -------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (evento) => {
    if (evento.data && evento.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((registro) => {
        console.log('[SW] Service Worker registrado con scope:', registro.scope);
      })
      .catch((error) => {
        console.error('[SW] Error al registrar el Service Worker:', error);
      });
  });
}

// --- Indicador visual de conectividad -------------------------------------
function actualizarIndicadorRed() {
  const badge = document.getElementById('badge-red');
  const enLinea = navigator.onLine;

  badge.textContent = enLinea ? 'En Línea' : 'Sin Conexión';
  badge.classList.toggle('online', enLinea);
  badge.classList.toggle('offline', !enLinea);
}

// --- CREATE: envío resiliente con fallback a IndexedDB --------------------
function procesarEnvioReporte(datosFormulario) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor: ' + respuesta.status);
      return respuesta.json();
    })
    .then(() => {
      // Envío exitoso en vivo: registrar en bitácora local como sincronizado
      return guardarRegistro({
        titulo: datosFormulario.titulo,
        descripcion: datosFormulario.descripcion,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando transacción localmente...');

      // Falla de red: guardar en IndexedDB como pendiente para reenvío posterior
      return guardarRegistro({
        titulo: datosFormulario.titulo,
        descripcion: datosFormulario.descripcion,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => {
          // Detección de soporte para Background Sync API
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then((registro) => {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              });
          }
        });
    })
    .then(() => {
      // Actualizar la lista visual en ambos escenarios
      return renderizarColaOutbox();
    });
}

// --- READ: pintar la cola de transacciones --------------------------------
function renderizarColaOutbox() {
  return obtenerTodosLosRegistros()
    .then((registros) => {
      const lista = document.getElementById('lista-outbox');
      const estadoVacio = document.getElementById('estado-vacio');

      lista.innerHTML = '';
      estadoVacio.hidden = registros.length > 0;

      registros
        .sort((a, b) => (b.fechaCreacion || 0) - (a.fechaCreacion || 0))
        .forEach((registro) => {
          const item = document.createElement('li');
          item.className = 'item-outbox';

          const info = document.createElement('div');
          info.className = 'item-info';

          const titulo = document.createElement('p');
          titulo.className = 'item-titulo';
          titulo.textContent = registro.titulo || 'Sin título';

          const meta = document.createElement('p');
          meta.className = 'item-meta';
          const fecha = new Date(registro.fechaCreacion || Date.now());
          meta.textContent = 'Creado: ' + fecha.toLocaleString('es-ES');

          info.appendChild(titulo);
          info.appendChild(meta);

          const estado = document.createElement('span');
          estado.className = 'pill ' + registro.estado;
          estado.textContent = registro.estado;

          item.appendChild(info);
          item.appendChild(estado);
          lista.appendChild(item);
        });
    })
    .catch((error) => {
      console.error('[Outbox] Error al leer IndexedDB:', error);
    });
}

// --- UPDATE (fallback): barrido y reenvío de pendientes --------------------
// Se usa solo en navegadores sin SyncManager (Safari/iOS, Firefox).
function sincronizarPendientesFallback() {
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      // Convertir cada registro pendiente en una promesa de envío + actualización
      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((respuesta) => {
            if (!respuesta.ok) throw new Error('Falla al reintentar envío');
            // Actualizar estado en IndexedDB de 'pendiente' a 'sincronizado'
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      // Esperar a que todos los reenvíos concluyan
      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

// --- Conexión del formulario (submit) ------------------------------------
document.getElementById('form-incidencia').addEventListener('submit', (evento) => {
  evento.preventDefault();

  const campoTitulo = document.getElementById('titulo');
  const campoDescripcion = document.getElementById('descripcion');

  const datosFormulario = {
    titulo: campoTitulo.value.trim(),
    descripcion: campoDescripcion.value.trim()
  };

  if (!datosFormulario.titulo || !datosFormulario.descripcion) {
    return;
  }

  procesarEnvioReporte(datosFormulario)
    .then(() => {
      evento.target.reset();
      campoTitulo.focus();
    })
    .catch((error) => {
      console.error('[Outbox] Error inesperado al procesar el reporte:', error);
    });
});

// --- DELETE: purga de registros ya sincronizados --------------------------
document.getElementById('btn-purgar').addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const sincronizados = registros.filter((item) => item.estado === 'sincronizado');

      if (sincronizados.length === 0) {
        console.log('[Outbox] No hay registros sincronizados por purgar.');
        return;
      }

      return Promise.all(
        sincronizados.map((item) => eliminarRegistro(item.id))
      );
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error al purgar registros:', error);
    });
});

// --- Eventos de conectividad ---------------------------------------------
window.addEventListener('online', () => {
  actualizarIndicadorRed();

  // Degradación elegante: solo sincronizar desde la UI si el navegador NO
  // soporta Background Sync (ej. Safari/iOS) para evitar POST duplicados.
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

// --- Inicialización -------------------------------------------------------
actualizarIndicadorRed();
renderizarColaOutbox();
