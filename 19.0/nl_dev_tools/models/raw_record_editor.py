# -*- coding: utf-8 -*-
import json
import logging

from markupsafe import Markup

from odoo import _, api, models
from odoo.exceptions import AccessError, UserError
from odoo.fields import Command
from odoo.tools import SQL, config

_logger = logging.getLogger(__name__)

EDITABLE_TYPES = {
    'char', 'text', 'html', 'integer', 'float', 'monetary', 'boolean',
    'selection', 'date', 'datetime', 'many2one', 'many2many',
}
MAGIC_FIELDS = {'id', 'create_uid', 'create_date', 'write_uid', 'write_date'}
MODES = ('orm', 'sql')


class DevToolsRawEditor(models.AbstractModel):
    _name = 'dev.tools.raw.editor'
    _description = 'Developer Tools: Raw Record Editor'

    # ------------------------------------------------------------------
    # Guards
    # ------------------------------------------------------------------

    @api.model
    def _is_enabled(self):
        # --dev=...,dev_tools (or ODOO_DEV); `--dev=all` deliberately does not count
        return 'dev_tools' in (config.get('dev_mode') or [])

    @api.model
    def _is_allowed(self):
        return bool(self._is_enabled() and self.env.user._is_system())

    @api.model
    def _check_access(self):
        if not self._is_enabled():
            raise AccessError(_("Developer tools are disabled. Start Odoo with --dev=dev_tools."))
        if not self.env.user._is_system():
            raise AccessError(_("Only Settings administrators can use the developer tools."))

    @api.model
    def _get_record(self, model_name, res_id):
        if model_name not in self.env:
            raise UserError(_("Unknown model %s.", model_name))
        Model = self.env[model_name]
        if Model._abstract:
            raise UserError(_("%s is not stored in the database.", model_name))
        record = Model.sudo().with_context(active_test=False).browse(int(res_id)).exists()
        if not record:
            raise UserError(_("%(model)s(%(id)s) does not exist.", model=model_name, id=res_id))
        return record

    # ------------------------------------------------------------------
    # Field classification
    # ------------------------------------------------------------------

    @api.model
    def _is_editable(self, field):
        return field.store and field.type in EDITABLE_TYPES and field.name not in MAGIC_FIELDS

    @api.model
    def _is_sql_editable(self, record, field):
        return self._is_editable(field) and field.type != 'many2many' and record._auto

    # ------------------------------------------------------------------
    # Public API (called from the dialog)
    # ------------------------------------------------------------------

    @api.model
    def get_record(self, model_name, res_id):
        self._check_access()
        record = self._get_record(model_name, res_id)
        descriptions = record.fields_get(attributes=[
            'string', 'type', 'relation', 'selection', 'help', 'digits',
        ])

        fields_info, spec = [], {}
        for name, field in record._fields.items():
            if not field.store or name not in descriptions:
                continue
            description = descriptions[name]
            fields_info.append({
                **description,
                'name': name,
                'flags': {
                    'computed': bool(field.compute) and not field.related,
                    'related': bool(field.related),
                    'readonly': bool(field.readonly),
                    'required': bool(field.required),
                    'translate': bool(field.translate),
                    'company_dependent': bool(field.company_dependent),
                },
                'editable': self._is_editable(field),
                'sql_editable': self._is_sql_editable(record, field),
            })
            if field.type in ('many2one', 'many2many'):
                spec[name] = {'fields': {'display_name': {}}}
            elif field.type != 'properties':
                spec[name] = {}

        values = record.with_context(bin_size=True).web_read(spec)[0]
        for info in fields_info:
            if info['type'] == 'one2many':
                values[info['name']] = len(values[info['name']])
        fields_info.sort(key=lambda f: (f['string'] or f['name']).lower())

        return {
            'display_name': record.display_name,
            'fields': fields_info,
            'values': values,
        }

    @api.model
    def save_record(self, model_name, res_id, values, mode='orm'):
        self._check_access()
        if mode not in MODES:
            raise UserError(_("Unknown save mode %s.", mode))
        record = self._get_record(model_name, res_id)
        if not values:
            return {'fields': [], 'mode': mode}

        for name in values:
            field = record._fields.get(name)
            allowed = field and (
                self._is_sql_editable(record, field) if mode == 'sql' else self._is_editable(field)
            )
            if not allowed:
                raise UserError(_("Field %(field)s cannot be edited in %(mode)s mode.",
                                  field=name, mode=mode.upper()))

        before = self._audit_values(record, values)
        if mode == 'orm':
            record.write(self._to_write_values(record, values))
        else:
            self._sql_update(record, values)
        after = self._audit_values(record, values)

        self._audit(record, mode, before, after)
        return {'fields': list(values), 'mode': mode}

    # ------------------------------------------------------------------
    # Writing
    # ------------------------------------------------------------------

    @api.model
    def _to_write_values(self, record, values):
        vals = {}
        for name, value in values.items():
            if record._fields[name].type == 'many2many':
                value = [Command.set(value or [])]
            vals[name] = value
        return vals

    @api.model
    def _sql_update(self, record, values):
        self.env.flush_all()
        lang = self.env.lang or 'en_US'
        assignments = []
        for name, value in values.items():
            field = record._fields[name]
            column = SQL.identifier(name)
            value = field.convert_to_column(value, record)
            if field.translate:
                if value is None:
                    assignments.append(SQL("%s = NULL", column))
                else:
                    # keep other languages, make sure en_US exists as the fallback
                    assignments.append(SQL(
                        "%s = %s::jsonb || COALESCE(%s, '{}'::jsonb) || %s::jsonb",
                        column, json.dumps({'en_US': value}), column, json.dumps({lang: value}),
                    ))
            elif field.company_dependent:
                company_key = str(self.env.company.id)
                if value is None:
                    assignments.append(SQL("%s = %s - %s", column, column, company_key))
                else:
                    assignments.append(SQL(
                        "%s = COALESCE(%s, '{}'::jsonb) || %s::jsonb",
                        column, column, json.dumps({company_key: value}, default=str),
                    ))
            else:
                assignments.append(SQL("%s = %s", column, value))

        self.env.cr.execute(SQL(
            "UPDATE %s SET %s WHERE id = %s",
            SQL.identifier(record._table), SQL(", ").join(assignments), record.id,
        ))
        if self.env.cr.rowcount != 1:
            raise UserError(_("SQL update touched %s rows, expected 1.", self.env.cr.rowcount))
        self.env.invalidate_all()

    # ------------------------------------------------------------------
    # Audit trail
    # ------------------------------------------------------------------

    @api.model
    def _audit_values(self, record, fnames):
        result = {}
        for name in fnames:
            field = record._fields[name]
            value = field.convert_to_export(record[name], record)
            result[name] = '' if value is False or value is None else str(value)
        return result

    @api.model
    def _audit(self, record, mode, before, after):
        changes = [(name, before[name], after[name]) for name in before]
        _logger.warning(
            "nl_dev_tools raw edit [%s] %s(%s) by %s (uid %s): %s",
            mode.upper(), record._name, record.id, self.env.user.login, self.env.uid,
            "; ".join(f"{name}: {old!r} -> {new!r}" for name, old, new in changes),
        )
        if not hasattr(record, 'message_post'):
            return
        items = Markup().join(
            Markup("<li><b>%s</b> (%s): %s &#8594; %s</li>") % (
                record._fields[name].string, name, old or '∅', new or '∅',
            )
            for name, old, new in changes
        )
        record.message_post(
            body=Markup("<p>Raw edit (%s) via Developer Tools</p><ul>%s</ul>") % (mode.upper(), items),
            message_type='comment',
            subtype_xmlid='mail.mt_note',
        )
