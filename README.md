# hanna-scripts

Scripts de Tampermonkey para la intranet de Hanna Colombia, versionados en GitHub para que el equipo trabaje sobre el mismo código y todos reciban las actualizaciones automáticamente en su navegador.

## Instalación (una sola vez, por persona)

1. Instala la extensión **Tampermonkey** en tu navegador.
2. Entra a este archivo en GitHub y dale clic a **Raw**:
   `https://raw.githubusercontent.com/TU_USUARIO/hanna-scripts/main/panel-hanna.user.js`
3. Tampermonkey detecta que es un userscript y te ofrece instalarlo. Acepta.

A partir de ahí, Tampermonkey revisa esa URL cada cierto tiempo (configurable en *Tampermonkey → Settings → Update*) y si el `@version` del archivo cambió, se actualiza solo. Si quieres forzar el chequeo ya: *Tampermonkey Dashboard → Utilities → Check for userscript updates*.

## Flujo de trabajo colaborativo

- **`main`** es la rama "estable" — la que todo el mundo tiene instalada vía `@updateURL`. Todo lo que llega ahí se propaga solo a los navegadores.
- Para cambios grandes o que quieras probar antes de soltar a todos, crea una rama (`git checkout -b feature/nueva-cosa`), trabaja ahí, y cuando esté listo haces merge a `main` **y subes el `@version`** en el header del script (Tampermonkey solo detecta cambios si el número de versión sube).
- Si alguien quiere probar tu rama antes del merge, puede instalar apuntando su propio `@updateURL`/`@downloadURL` a esa rama en vez de `main`.

## Pasos para dejarlo en GitHub

```bash
# 1. Crea el repo en GitHub (público) llamado "hanna-scripts", vacío, sin README
# 2. Desde esta carpeta:
git remote add origin https://github.com/TU_USUARIO/hanna-scripts.git
git branch -M main
git push -u origin main
```

Después de esto, reemplaza `TU_USUARIO` en:
- `panel-hanna.user.js` (líneas `@updateURL` y `@downloadURL`)
- este README

por tu usuario real de GitHub, y vuelve a hacer commit/push.

## Cuando hagas un cambio

1. Edita `panel-hanna.user.js`.
2. Sube el número de `@version` (ej: `13.0` → `13.1`).
3. `git add -A && git commit -m "Descripción del cambio" && git push`
4. En un rato (o forzando el check manual), todos los navegadores con el script instalado se actualizan solos.
