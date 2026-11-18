# PWA Outbox - Registro de Incidencias

PWA de registro de incidencias en campo con **bandeja de salida offline** sobre
IndexedDB, sincronización en segundo plano (Background Sync API) y App Shell
cacheado por un Service Worker.

## Demo

GitHub Pages: `https://<usuario>.github.io/<repositorio>/`

## Características

- **Offline-first**: si el envío falla, el reporte se guarda en IndexedDB como `pendiente`.
- **Background Sync**: el Service Worker reintenta el envío cuando vuelve la conexión.
- **App Shell**: `index.html`, estilos, scripts e iconos se sirven desde caché.
- **Purgado** de transacciones sincronizadas desde la interfaz.

## Estructura

| Archivo | Descripción |
| --- | --- |
| `index.html` | App Shell y formulario |
| `app.js` | Lógica de UI, envío resiliente y registro del Service Worker |
| `db-helper.js` | Mini-wrapper de IndexedDB (compartido con el SW) |
| `sw.js` | Caché del App Shell y motor de sincronización |
| `manifest.json` | Metadatos de instalación de la PWA |
| `icons/` | Iconos 192px y 512px |

## Ejecutar en local

```bash
npx serve .
# o
python -m http.server 8080
```

Abre `http://localhost:8080` (los Service Workers requieren `localhost` o HTTPS).

## Notas

- El endpoint de prueba es `https://jsonplaceholder.typicode.com/posts`.
- Background Sync es soportado en navegadores basados en Chromium.
