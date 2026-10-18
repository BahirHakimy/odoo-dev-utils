# -*- coding: utf-8 -*-
{
    'name': "Developer Tools",

    'summary': """
        Raw record editor for development databases""",

    'description': """
        Adds "Edit Raw Record" to the form view debug menu: edit any stored
        field of a record (readonly, invisible, computed and state fields
        included) through the ORM or, as a fallback, a raw SQL UPDATE.

        Disabled unless Odoo runs with `--dev=...,dev_tools` (or ODOO_DEV), and
        restricted to Settings administrators. Never enable it in production.
    """,

    'author': "NETLINKS LTD",
    'website': "https://www.netlinks.af",
    'category': 'Hidden/Tools',
    'version': '19.0.1.0.0',
    'license': 'AGPL-3',
    'application': False,
    'installable': True,

    'depends': ['web'],

    'assets': {
        'web.assets_backend': [
            'nl_dev_tools/static/src/**/*',
        ],
    },
}
