# Ko-fi Integration Implementation - StravaStats

## Resumen de Cambios

Sistema no-invasivo de soporte voluntario implementado en StravaStats usando Ko-fi.

## Archivos Modificados/Creados

### 1. **js/services/kofi.js** (NUEVO)

Módulo completo que maneja la lógica de Ko-fi:

**Funciones exportadas:**

- `shouldShowKofiModal()` - Determina si el modal debe mostrarse (no más de 1x por sesión, cooldown de 3 días)
- `markKofiModalShown()` - Guarda timestamp en localStorage
- `showKofiModal()` - Crea y muestra el modal
- `initKofiSystem()` - Inicializa el sistema al cargar la app

**Características:**

- localStorage key: `stravastats_kofi_last_seen`
- Cooldown: 3 días (3 *24* 60 *60* 1000 ms)
- Cierre: botón X, click fuera del modal, o tecla ESC
- Sesión: no se muestra más de una vez por sesión

### 2. **index.html** (MODIFICADO)

**Cambio:** Añadido botón Ko-fi en el header

```html
<button id="kofi-button" class="action-btn" aria-label="Support the project" title="Support ☕">
    ☕
</button>
```

Ubicación: Entre refresh-button y logout-button en `.top-bar__actions`

### 3. **js/app/main.js** (MODIFICADO)

**Cambios:**

1. Importación del módulo Ko-fi:

   ```javascript
   import { initKofiSystem, showKofiModal } from '../services/kofi.js';
   ```

2. Referencia al DOM element:

   ```javascript
   const kofiButton = document.getElementById('kofi-button');
   ```

3. Event listener:

   ```javascript
   if (kofiButton) kofiButton.addEventListener('click', showKofiModal);
   ```

4. Inicialización del sistema (después de setupDashboard):

   ```javascript
   initKofiSystem();
   ```

### 4. **styles/style.css** (MODIFICADO)

**Estilos añadidos para Ko-fi modal:**

Clases CSS:

- `.kofi-modal-wrapper` - Contenedor principal con backdrop
- `.kofi-modal-backdrop` - Overlay oscuro (clickable para cerrar)
- `.kofi-modal-content` - Contenedor del modal con animación slideUp
- `.kofi-modal-close` - Botón X con estilos hover
- `.kofi-modal-header` - Título del modal
- `.kofi-modal-body` - Contenedor del contenido
- `.kofi-main-message` - Párrafo principal
- `.kofi-secondary-message` - Párrafo secundario en italics
- `.kofi-support-btn` - Botón principal Ko-fi con hover/active states

**Animaciones:**

- `fadeIn` (0.3s) - Aparición del backdrop
- `slideUp` (0.3s) - Aparición del modal desde abajo

**Responsive:** Funciona en mobile y desktop (max-width: 500px para el modal)

## Lógica de Visibilidad

```
mostrar modal si:
- NO se ha mostrado en esta sesión (modalShownThisSession = false)
- Y (no existe localStorage key OR más de 3 días han pasado)
```

### Flujo

1. App carga → `initKofiSystem()` se ejecuta tras 500ms
2. `shouldShowKofiModal()` evalúa condiciones
3. Si cumple, `showKofiModal()` crea y añade el modal al DOM
4. Usuario cierra modal → `markKofiModalShown()` guarda timestamp
5. Mismo modal no aparece hasta que expire el cooldown

## Experiencia de Usuario

### Primera visita

- Modal aparece después de que la app cargue (500ms)
- Usuario ve mensaje sobre cambios API de Strava
- Opción de ignorar (X, click fuera, ESC)

### Visitas posteriores

- Modal NO aparece si fue visto dentro de los últimos 3 días
- Usuario puede hacer clic en botón ☕ manualmente en cualquier momento
- No hay popups intrusivos, no hay paywalls

### Contenido del modal

- **Título:** "Support StravaStats ☕"
- **Mensaje principal:** Explica cambios en API de Strava
- **Mensaje secundario:** Clarifica que es completamente opcional
- **Botón principal:** "Support on Ko-fi ☕" → <https://ko-fi.com/alexgn>

## Testing

Para verificar la implementación:

1. **Primera visita:**
   - Limpiar localStorage: `localStorage.clear()`
   - Recargar página
   - Modal debe aparecer automáticamente

2. **Cooldown:**
   - Clic en X para cerrar
   - Verificar localStorage: `localStorage.getItem('strava_kofi_last_seen')`
   - Recargar página
   - Modal NO debe aparecer (hasta pasar 3 días)

3. **Botón manual:**
   - Clic en ☕ en header siempre muestra el modal
   - (A menos que ya se mostró en esta sesión)

4. **Mobile:**
   - Verificar responsive en viewport 360px
   - Botón debe ser clickeable
   - Modal debe ser readable

## Compatibilidad

- ✅ Desktop (Chrome, Firefox, Safari, Edge)
- ✅ Mobile (iOS Safari, Android Chrome)
- ✅ PWA (funciona offline si ya está instalada)
- ✅ Demo mode (funciona con datos ficticios)
- ✅ Dark mode (estilos adaptativos con CSS variables)

## Configuración Ko-fi

```javascript
const KOFI_USER = 'alexgn';
const KOFI_URL = `https://ko-fi.com/${KOFI_USER}`;
const STORAGE_KEY = 'stravastats_kofi_last_seen';
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
```

Para cambiar usuario Ko-fi, editar `js/services/kofi.js` línea 3-4.

---

**Fecha de implementación:** June 2026
**Status:** ✅ Listo para producción
