# Cambios en la API de Strava - Contexto para StravaStats

## 🚨 ¿QUÉ PASÓ? (Junio 2026)

El 1 de junio de 2026, Strava implementó cambios drásticos en su Developer Program que **destruyeron el ecosistema independiente de desarrolladores**.

### Cambios Específicos (Efectivos Inmediatamente)

#### ⚠️ **NUEVA: Requiere Suscripción de Strava**

- **Todos los nuevos desarrolladores** necesitan pagar una suscripción de Strava para acceder a la API
- **Desarrolladores existentes:** 3 meses gratis, luego **requieren suscripción**
- Esto significa: **Lo que era completamente gratis de crear y mantener ahora cuesta dinero**

#### 🔒 **Restricciones de Acceso por Tier**

**Standard Tier (el que afecta apps como StravaStats):**

- Máximo 10 atletas
- Rate limits reducidos
- Sin acceso a Extended APIs
- Sin soporte prioritario

**Extended Access Tier:**

- Requiere aprobación especial (difícil para apps indie)
- Acceso a APIs adicionales
- Rate limits más altos

#### 🚫 **APIs Deprecadas**

- **Club Activities endpoint** (Septiembre 2026)
- **Club Administrators endpoint** (Septiembre 2026)
- **Club Members endpoint** (Septiembre 2026)
- **Segments Explore endpoints** (solo para Extended Access)

Strava esencialmente está **eliminando funcionalidades sin reemplazo** para las apps independientes.

#### 🔌 **Bloqueo de Arquitecturas Alternativas**

- "Apps routing Strava data through third-party intermediary platforms are no longer supported"
- Esto crea fricción adicional para herramientas que querían distribuirse libremente

#### 🔴 **Cambios Técnicos Futuros** (Junio 2027)

- Base URL cambia de `https://www.strava.com/api/v3` → `https://www.api-v3.strava.com`
- Autorización debe ir en headers, no en form params
- OAuth deauthorize endpoint será removido

---

## 😤 ¿POR QUÉ ESTO ES INDIGNANTE?

### El Verdadero Problema

**Strava está usando el crecimiento explosivo de la plataforma para monetizar el ecosistema que lo construyó.**

Cita oficial de Strava:
> "AI companies are aggressively attempting to scrape platforms for training data, abuse APIs through intermediary layers, and provide zero-code AI tools that produce apps that hammer APIs."

**Traducción real:**

- "Hay scraping, así que vamos a castigar a TODOS los desarrolladores independientes"
- Están usando el problema del AI scraping como excusa para poner paywall a todo
- Las aplicaciones legítimas (como StravaStats) pagan el precio

### El Impacto Colateral

- ✅ 241,000 desarrolladores usando la API
- ❌ Ahora todos necesitan pagar suscripción
- ❌ Funcionalidades básicas desaparecen sin alternativa
- ❌ Apps indie mueren por incapacidad de financiar acceso

### La Ironía

Strava dice:
> "Every Strava athlete can still access and download their data for free"

Pero:

- ✅ Usuarios pueden descargar datos (free)
- ❌ Herramientas que **ayudan a analizar esos datos** ahora requieren suscripción
- ❌ Los desarrolladores que **construyeron el ecosistema** quedan excluidos

---

## 📊 IMPACTO EN STRAVASTATS

StravaStats **fue creado completamente gratis y siempre fue gratis:**

- ✅ 0$ en costos de servidor (datos en tu navegador)
- ✅ 0$ de acceso a API (desarrollo libre)
- ✅ 100% voluntario

**Ahora:**

- ❌ Requiere pagar suscripción a Strava para funcionar
- ❌ Limitado a 10 atletas (problema si app crece)
- ❌ Sin garantía de que endpoints clave sigan disponibles
- ❌ Riesgo de que desaparezcan features sin previo aviso

**Resultado:** Una herramienta que **ayudaba a la comunidad Strava** ahora debe cargarse sus costos a usuarios, o simplemente muere.

---

## 📰 FUENTES OFICIALES

### Anuncio Oficial de Strava
<https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428>

Contiene:

- Detalles de la nueva Developer Program
- FAQ sobre cambios
- API Policy actualizada
- Cronograma de deprecaciones

### Reacciones de la Comunidad Developer
<https://www.reddit.com/r/selfhosted/comments/1ttve5y/stravas_new_developer_program_just_killed_every/>

Cientos de desarrolladores comentando:

- Cómo el cambio destruye sus proyectos
- Apps shutting down
- Frustración con la táctica

---

## 💭 LO QUE STRAVA NO DICE

Leyendo entre líneas del comunicado oficial:

**"We care deeply about developers"**
→ *Excepto a los que no pagan*

**"Start building immediately, completely eliminating the previous queue"**
→ *Sí, pero ahora necesitas una tarjeta de crédito*

**"No developer skills required"** (sobre su Strava MCP)
→ *Pero SÍ necesitas suscripción*

---

## 🤔 ¿QUÉ SIGNIFICA PARA TI?

### Si eres usuario de StravaStats

- Puedes seguir usando la app gratuitamente
- Pero ahora depende de contribuciones voluntarias
- El futuro es incierto si Strava sigue apretando

### Si eres desarrollador indie

- Tu proyecto de análisis de Strava está en peligro
- Tienes dos opciones: pagar suscripción o abandonar
- No hay punto medio

### Si contribuyes a StravaStats

- Tu apoyo mantiene la app viva
- Ayuda a pagar el costo que Strava ahora impone
- Defiende el desarrollo independiente

---

## 🎯 POR QUÉ ESTA APP MERECE APOYO

StravaStats es diferente porque:

1. **Es privado:** Tus datos nunca salen de tu navegador
2. **Es honesto:** Usa la API de Strava de forma legítima
3. **Es independiente:** Nadie está ganando dinero vendiendo tus datos
4. **Es técnicamente avanzado:** Análisis que Strava premium no ofrece
5. **Ahora enfrenta costos impuestos:** Por una plataforma que no lo considera "partner"

---

## 📌 TL;DR

| Aspecto | Antes (2025) | Ahora (2026) |
|--------|------------|-------------|
| **Costo de desarrollo** | $0 | Suscripción Strava + API costs |
| **Usuarios soportados** | Ilimitado | 10 máximo (Standard Tier) |
| **APIs disponibles** | Todas | Limitadas, algunas deprecadas |
| **Modelo** | Completamente libre | Restricción por paywall |
| **Viabilidad indie** | Alta | Muy baja |

**Strava priorizó monetización sobre comunidad.**

StravaStats necesita tu apoyo para seguir existiendo.

---

**Léelo en detalle:** [Anuncio oficial de Strava](https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428)

**Ve las reacciones:** [Reddit: Stravas New Developer Program just killed every...](https://www.reddit.com/r/selfhosted/comments/1ttve5y/stravas_new_developer_program_just_killed_every/)
