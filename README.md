# odoo-dev-tools

Reusable developer tools for Odoo projects. **Development databases only.**

One folder per Odoo version; each holds installable addons.

| Version | Addon | What it does |
|---|---|---|
| 19.0 | `nl_dev_tools` | Form view debug menu → **Edit Raw Record**: edit any stored field (readonly, invisible, computed, `state`) through the ORM, or with a raw SQL `UPDATE` as a fallback |

## Mounting into a container

The example below uses Odoo 19. Replace the service, container, database, and
configuration paths with those used by your project.

1. Add the versioned tools directory to your project's environment file:
   ```
   DEV_TOOLS_PATH_19=/absolute/path/to/odoo-dev-tools/19.0
   ```
2. Mount it in the Odoo service in your Compose file:
   ```yaml
   - ${DEV_TOOLS_PATH_19}:/mnt/dev-tools-19
   ```
3. Add the mount to `addons_path` in `odoo.conf`:
   ```ini
   addons_path = ...,/mnt/dev-tools-19
   ```
   and enable the tools by adding `dev_tools` to Odoo's `--dev` option, e.g. in
   the Compose `command:`
   ```yaml
   command: ['odoo', '--config=/etc/odoo/odoo.conf', '--dev=xml,qweb,dev_tools']
   ```
   or through the environment: `ODOO_DEV=xml,qweb,dev_tools`.

   `--dev=all` does not enable the tools; `dev_tools` must be named explicitly.
4. Recreate the service (a restart does not pick up new volumes), install the
   addon, and restart the container:
   ```bash
   docker compose up -d --force-recreate your-odoo-service
   docker exec -it your-odoo-container odoo -c /etc/odoo/odoo.conf -d your-database -i nl_dev_tools --stop-after-init
   docker restart your-odoo-container
   ```

## Guardrails

- Does nothing unless Odoo runs with `--dev=...,dev_tools` (or `ODOO_DEV`), even when installed.
- Settings administrators (`base.group_system`) only, checked server-side.
- Lives in the debug menu, so developer mode is required.
- Every save is logged as a server warning and, on models with a chatter, posted as a note listing old → new values.

## Edit Raw Record

- **ORM mode** (default): `sudo().write()`. Constraints, `write()` overrides, recomputes and tracking all run. A computed stored field keeps the value you set until one of its dependencies changes.
- **Raw SQL mode**: a parameterised `UPDATE` on the record's table, then the ORM cache is cleared. Skips everything above and leaves `write_date` untouched. Translated fields only change the current language (`en_US` is created if missing); company-dependent fields only change the current company. Many2many fields are not editable in this mode.
- Editable types: char, text, html (as plain text), integer, float, monetary, boolean, selection, date, datetime, many2one, many2many. Everything else is shown read-only.
