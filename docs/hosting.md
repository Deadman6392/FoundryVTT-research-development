# Hosting: getting files to players faster

A dnd5e world with around 100 modules asks every player's browser for well over a thousand files at startup:
JavaScript, CSS, templates, language files, icons. How the server delivers those files often matters more for load
time than anything a module can do. The Performance Triage report measures this on each client (open
**Files loaded during startup** in the report), so you don't have to guess.

Read this page only if the report raises one of these findings:

| Finding | What it means | Fix |
| --- | --- | --- |
| Files are served over HTTP/1.1 | The browser can only fetch about 6 files at a time from your server, so a thousand small files queue up. | Put Foundry behind a reverse proxy that speaks HTTP/2 or HTTP/3. |
| Text files are sent uncompressed | JavaScript/CSS/JSON go over the wire at full size. | Turn on compression in the proxy. |
| The browser re-checks most files on every load | Each file costs a round trip even when it hasn't changed. | Mostly fixed by HTTP/2, where those checks share one connection. |

If you use a managed host (The Forge, Molten and similar), you can't change any of this yourself, but the report will
show whether your host already does it; if it doesn't, that's worth raising with their support.

## Caddy (simplest)

Foundry's official guide: <https://foundryvtt.com/article/caddy/>. Caddy enables HTTP/2 and HTTP/3 automatically
once it has a certificate, so the only addition to Foundry's example is compression:

```caddyfile
your.hostname.com {
    encode zstd gzip
    reverse_proxy localhost:30000
}
```

Then set `proxyPort` and `proxySSL` in Foundry's `options.json` as the official guide describes.

## nginx

Foundry's official guide: <https://foundryvtt.com/article/nginx/>. Its example uses `listen 443 ssl;`, which is
HTTP/1.1 only. Add HTTP/2 and compression to the `server` block:

```nginx
server {
    server_name your.hostname.com;
    listen 443 ssl;
    http2 on;                  # nginx 1.25.1+; on older versions use: listen 443 ssl http2;

    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types text/css application/javascript text/javascript application/json image/svg+xml;

    # ...the rest of Foundry's example (certificates, client_max_body_size, location / with proxy headers)...
}
```

HTTP/2 needs HTTPS in browsers, so this only applies to the SSL variant of the config.

## Hosting from your own PC with port forwarding

That is the most common setup and also the one most likely to show the HTTP/1.1 finding, since Foundry's built-in
server is reached directly. Options, from least to most effort:

1. Accept it, and lean on the world and module findings instead. Browsers keep cached copies between sessions, so
   repeat loads mostly pay for round trips rather than downloads; the first load after updating modules pays both.
2. Run Caddy on the same PC in front of Foundry. It needs a hostname that resolves to your public IP (a free dynamic
   DNS name works) so it can get a certificate.
3. Move the server to a small VPS or a managed host. Foundry's server needs very little CPU; your upload bandwidth
   stops being the bottleneck for every player at once.

## What not to do

Don't make the proxy serve Foundry's static files itself or override Foundry's caching headers. Foundry's own guides
advise against it: the gains are small, and a stale cached module file after an update produces confusing errors.

## Enabling the CPU profiler (optional)

The report's **CPU profile** section uses the browser's JS Self-Profiling API, which shows exactly which module is
using CPU time, including inside libWrapper wrappers that the hook profiler can't see. Browsers only allow it when the
page is served with a `Document-Policy: js-profiling` header. It works in Chrome, Edge and the Foundry desktop app, not
Firefox or Safari.

Caddy:

```caddyfile
your.hostname.com {
    encode zstd gzip
    header Document-Policy "js-profiling"
    reverse_proxy localhost:30000
}
```

nginx, inside `location / { ... }`:

```nginx
add_header Document-Policy "js-profiling" always;
```

The header has no effect unless something actually starts a profile, so leaving it on is harmless.
