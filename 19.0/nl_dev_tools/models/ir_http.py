# -*- coding: utf-8 -*-
from odoo import models


class IrHttp(models.AbstractModel):
    _inherit = 'ir.http'

    def session_info(self):
        result = super().session_info()
        result['dev_tools_enabled'] = self.env['dev.tools.raw.editor']._is_allowed()
        return result
