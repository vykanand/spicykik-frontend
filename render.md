# Render System — documentation for server- and client-side preview rendering

This document describes how rendering works in this repository (server-side and client-side), where it is used, how the live preview behaves, and how to diagnose and fix rendering issues.

Files referenced frequently

- `server.js` — primary server code; route `/site/:siteName/*` performs server-side rendering for HTML pages (injection, simple templating, API data substitution).
- `admin-static/custom-builder.js` — custom builder editor and live preview logic. It prefers server-rendered HTML and falls back to client-side rendering when needed.
- `admin-static/app.js` — admin UI code that also opens previews and uses the same URL encoding helper for `/site/...` links.

Overview of goals

- Always prefer server-rendered HTML for the preview so that what you see in the admin/custom-builder matches production behavior.
- When server-side render is not available or fails, fall back to client-side rendering using a sequence of renderers: Handlebars (if present or dynamically loadable), Mustache (if present), then a lightweight fallback that supports basic `{{var}}` and `{{#each x}}...{{/each}}` patterns.
- Use a robust path encoder on the client when building `/site/<site>/<path>` URLs to ensure slashes are preserved while individual path segments get URL-encoded (prevents breaking Express wildcard matching when paths contain spaces or special characters).

Detailed pieces

1. Server-side rendering (what `server.js` does)

- Route: `GET /site/:siteName/*`
  - Reads the page file at `websites/<siteName>/<path>` (if not an `.html` file it sends the file directly).
  - If the site is listed in the DB, the server attempts to "inject" API-driven content:
    - It fetches configured APIs for the site (`fetchAPIsForSite(site)`) and aggregates the results into `apiData`.
    - It applies simple template transformations on `content`:
      - `{{#each apiName.jsonPath}}...{{/each}}` loops — the server extracts the list at the JSON path and repeats the inner block, substituting `{{this.prop}}`.
      - Mappings from `mappings.json` are applied (placeholder replacements) when present.
      - Direct placeholders like `{{apiName.path.to.value}}` replaced via lodash.get-style lookup on `apiData`.
    - Finally, server injects client-side wiring script for action bindings if `siteMappings.actions` exist (these scripts allow buttons/forms to call back to `/api/sites/:siteName/endpoints/:apiName/execute`).
  - The server returns fully built HTML which the admin UI uses for preview so the preview is as close to production as possible.

Notes about the server-side templating

- This is intentionally lightweight and not a full Handlebars runtime. It supports the common patterns used by the template generators (basic `{{var}}` substitution and `{{#each}}` loops).
- The server relies on the `mappings.json` mappings to replace named placeholders if you used the page mapping UI.

2. Client-side preview rendering (admin UI & custom builder)

- Preference: the client first attempts to fetch `/site/<siteName>/<path>?t=<timestamp>` and use that server-rendered HTML in the preview iframe via `iframe.srcdoc` (after sanitization).
- If the server fetch fails (e.g. CORS, server offline, or the route returned an error), the client falls back to a client-side render pipeline implemented in `admin-static/custom-builder.js`:
  - `renderTemplateForPreviewAsync(template, data)` — async function that tries in order:
    1. Ensure/Load Handlebars (`ensureHandlebars()` tries several CDNs).
    2. If Handlebars is available, compile & render: `Handlebars.compile(template)(data)`.
    3. Else if `Mustache` exists, use `Mustache.render(template, data)`.
    4. Else use the lightweight fallback (supports `{{path}}` and `{{#each path}}...{{/each}}`).
  - The result is sanitized with `sanitizeHtmlForPreview(html)` before being assigned to `iframe.srcdoc`.

3. `encodePathForUrl` helper (client-side)

- Function purpose: encode each path segment with `encodeURIComponent` but preserve `/` separators so Express wildcard route (`/site/:siteName/*`) receives the correct path.
- Behavior implemented for robust handling across the admin UI and custom builder:
  - If input is empty or `/` -> returns empty string (makes URL `/site/<site>/`).
  - Strips leading/trailing slashes from a path like `/products/index.html` -> `products/index.html`.
  - Splits on `/`, `encodeURIComponent` each segment, then rejoins with `/`.
- Usage locations:
  - `admin-static/custom-builder.js`: initial load preview and save preview update.
  - `admin-static/app.js`: admin UI preview links, open rendered page, and preview frame reloads.

4. Sanitization for preview: `sanitizeHtmlForPreview(html)`

- Removes `<script>` blocks and strips inline `on*` event handlers (best-effort) and disables `javascript:` pseudo-URLs for `href/src` attributes.
- The preview uses `iframe.srcdoc` with sanitized HTML to avoid executing arbitrary admin-side scripts in the preview sandbox (the iframe remains restrictive for safety).

Where rendering is used across the repo

- `server.js` — server-side rendering `GET /site/:siteName/*` (preferred source of truth for previews and production rendering).
- `admin-static/custom-builder.js` — the custom editor's load and save flows:
  - `loadPageIntoEditor(path, siteName)` — attempts server-rendered preview first, falls back to `renderTemplateForPreviewAsync`.
  - Save handler (`#savePageBtn`) — after saving via `/api/sites/:siteName/pages/save` attempts to refresh the preview by fetching `/site/<site>/<path>?t=` (server render), falls back to client-side render.
  - `renderTemplateForPreviewAsync`/`ensureHandlebars` and `sanitizeHtmlForPreview` live here.
- `admin-static/app.js` — admin UI coverage (list pages, load into editor, preview open in new tab). Uses `encodePathForUrl` when constructing `/site/...` URLs.

Testing & troubleshooting

- Steps to test manually:
  1. Start the server locally: `node server.js` (or `npm start` if configured). Default port is 3000.
  2. Open admin: `http://localhost:3000/admin`.
  3. Select a site and open the custom builder or editor. When a page is loaded, look at DevTools -> Network to see the `/site/<site>/<path>?t=` request.
  4. Confirm the preview iframe uses the server response (status 200) and the console logs `Loaded Handlebars from` (if client-side fallback loaded Handlebars) or `Rendering with Handlebars` / `Rendering with lightweight fallback`.

- If preview shows raw template placeholders (e.g., `{{api.name}}`) instead of substituted values:
  - Check the DevTools network tab for the `/site/...` fetch. If that request succeeds with proper HTML, the client should display it.
  - If the server request fails, client fallbacks will attempt to render locally. If Handlebars is blocked from CDN (CSP / offline), the lightweight fallback might not support all template constructs — in that case vendor Handlebars locally.

Vendoring Handlebars (recommended if CDNs are blocked)

1. Download a suitable `handlebars.min.js` (e.g., v4.7.7) into `admin-static/libs/handlebars.min.js`.
2. Update `ensureHandlebars()` in `admin-static/custom-builder.js` to try the local path as a fallback (it already tries multiple CDNs; add `'/admin-static/libs/handlebars.min.js'` as the final candidate).

Where to fix if behavior differs between admin and production

- Because the server-side `/site/:siteName/*` performs the primary substitutions, any mismatch between preview and production is often due to one of:
  - Different `mappings.json` or `api-repo.json` DB contents between environments.
  - Client preview using a fallback renderer instead of the server-rendered HTML.
- Prefer fixing server-side rendering rules in `server.js` if you need richer templating (or add a genuine runtime like Handlebars server-side), but note that the server-side logic is intentionally minimal and optimized for common cases used by the app.

Quick checklist for debugging a broken preview rendering

- Is the `/site/<site>/<path>?t=` network request returning 200? If yes, inspect the response HTML for substituted values.
- If the `/site/...` request fails, check server logs (console output where `server.js` runs) to see file-not-found or errors.
- If the client is attempting to run Handlebars but CDNs are blocked, vendor Handlebars locally and add local fallback URL to `ensureHandlebars()`.
- Confirm `encodePathForUrl` is used when building `/site/...` links so encoded segments don't break the server route.

Appendix — quick reference to relevant functions

- server.js
  - `app.get('/site/:siteName/*', ...)` — server-side HTML processing & injection
  - `fetchAPIsForSite(site)` — server-side aggregated API fetching
- admin-static/custom-builder.js
  - `loadPageIntoEditor(path, siteName)` — loads page content into editor and updates preview (server-first)
  - `renderTemplateForPreviewAsync(template, data)` — client-side render pipeline (Handlebars -> Mustache -> fallback)
  - `ensureHandlebars()` — dynamic loader that tries CDNs
  - `sanitizeHtmlForPreview(html)` — sanitizes HTML before setting `iframe.srcdoc`
  - `encodePathForUrl(p)` — path encoder used for /site links
- admin-static/app.js
  - Admin UI equivalents that build preview links and open rendered pages with `encodePathForUrl`.

If you'd like, I can also:

- Vendor `handlebars.min.js` into `admin-static/libs/` and add it to `ensureHandlebars()` as a final fallback.
- Run the server here and capture a sample preview request and console logs, or provide an exact list of grep matches that still need updating.

---

Change log (this PR):

- Added robust `encodePathForUrl` helpers in `admin-static/custom-builder.js` and `admin-static/app.js`.
- Replaced client preview URL building to use the helper so root (`/`) and nested paths are handled correctly.
- Created this `render.md` documenting how rendering works across the project.
