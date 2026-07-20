# ext-updates

Self-hosted update feed for self-distributed (unlisted) Firefox extensions.
Not a public listing — installs find new versions via each extension's
`browser_specific_settings.gecko.update_url`, which points here.

## Extensions

- **modo-bot/** — Modo Bot. Scheduled/config-driven purchase automation for
  modo.us. `updates.json` served at
  `https://iancox-cmyk.github.io/ext-updates/modo-bot/updates.json`
- **autoclicker/** — Simple AutoClicker. Local autoclicker, no network access.
  `updates.json` served at
  `https://iancox-cmyk.github.io/ext-updates/autoclicker/updates.json`

Each folder holds the extension's source (`manifest.json` + scripts) and its
`updates.json` feed. Signed `.xpi` releases get added alongside `updates.json`
as they're built — see the release process in each source project's
`EXTENSION_RELEASE.md`.

GitHub Pages must be enabled on this repo (Settings → Pages → Deploy from
branch → `main` / root) for the `update_url`s above to resolve.

## New-machine install

**macOS / Linux:**

```
curl -fsSL https://raw.githubusercontent.com/iancox-cmyk/ext-updates/main/install.sh | bash
```

**Windows (PowerShell):**

```
irm https://raw.githubusercontent.com/iancox-cmyk/ext-updates/main/install.ps1 | iex
```

Both download the signed `.xpi`s and open each in Firefox — click "Add" on
the one install prompt per extension that Firefox shows. After that,
`update_url` keeps both current automatically; the script only needs to
run once per machine.
