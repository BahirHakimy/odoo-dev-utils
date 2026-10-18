# odoo-dev-tools

Developer tools for NETLINKS Odoo projects. **Development databases only.**

One folder per Odoo version; each holds installable addons.

| Version | Addon | What it does |
|---|---|---|
| 19.0 | `nl_dev_tools` | Form view debug menu → **Edit Raw Record**: edit any stored field (readonly, invisible, computed, `state`) through the ORM, or with a raw SQL `UPDATE` as a fallback |

## Mounting into a container

Using `vdo_odoo_19` as the example (the compose file lives in `../docker-compose.yml`):

1. `../.env`
   ```
   DEV_TOOLS_PATH_19=/Users/<you>/Desktop/odoo-projects/odoo-dev-tools/19.0
   ```
2. `../docker-compose.yml`, under the service's `volumes:`
   ```yaml
   - ${DEV_TOOLS_PATH_19}:/mnt/dev-tools-19
   ```
3. `../docker/<project>.conf`
   ```ini
   addons_path = ...,/mnt/dev-tools-19
   dev_tools_enabled = True
   ```
4. Recreate the container (a restart does not pick up new volumes) and install:
   ```bash
   docker compose up -d vdo_odoo_19
   docker exec -it vdo-19-odoo odoo -c /etc/odoo/odoo.conf -d vdo-19 -i nl_dev_tools --stop-after-init
   docker restart vdo-19-odoo
   ```

Odoo logs `unknown option 'dev_tools_enabled'` at startup; that is expected.

## Guardrails

- Does nothing unless `dev_tools_enabled = True` is in `odoo.conf`, even when installed.
- Settings administrators (`base.group_system`) only, checked server-side.
- Lives in the debug menu, so developer mode is required.
- Every save is logged as a server warning and, on models with a chatter, posted as a note listing old → new values.

## Edit Raw Record

- **ORM mode** (default): `sudo().write()`. Constraints, `write()` overrides, recomputes and tracking all run. A computed stored field keeps the value you set until one of its dependencies changes.
- **Raw SQL mode**: a parameterised `UPDATE` on the record's table, then the ORM cache is cleared. Skips everything above and leaves `write_date` untouched. Translated fields only change the current language (`en_US` is created if missing); company-dependent fields only change the current company. Many2many fields are not editable in this mode.
- Editable types: char, text, html (as plain text), integer, float, monetary, boolean, selection, date, datetime, many2one, many2many. Everything else is shown read-only.
