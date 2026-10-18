import { Component, onWillStart, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";
import { serializeDate, serializeDateTime } from "@web/core/l10n/dates";
import { _t } from "@web/core/l10n/translation";
import { useService } from "@web/core/utils/hooks";
import { Record } from "@web/model/record";
import { Field } from "@web/views/fields/field";

const EDITOR_MODEL = "dev.tools.raw.editor";

// Field types rendered with a different widget than the form view default.
const WIDGETS = {
    html: "text",
    monetary: "float",
    many2many: "many2many_tags",
};

/** Value of a field in the format save_record() expects. */
function serializeValue(type, value) {
    switch (type) {
        case "many2one":
            return value ? value.id : false;
        case "many2many":
            return [...value.currentIds].sort((a, b) => a - b);
        case "date":
            return value ? serializeDate(value) : false;
        case "datetime":
            return value ? serializeDateTime(value) : false;
        default:
            return value;
    }
}

/** Text shown for fields that are not editable (one2many, binary, magic fields...). */
function displayValue(field, value) {
    if (value === false || value === null || value === undefined) {
        return "";
    }
    switch (field.type) {
        case "many2one":
            return value.display_name || String(value.id);
        case "many2many":
            return value.map((v) => v.display_name).join(", ");
        case "one2many":
            return _t("%s record(s)", value);
        default:
            return typeof value === "object" ? JSON.stringify(value) : String(value);
    }
}

/**
 * Hosts the standalone Record for one field. Its props never change during
 * the dialog's life (except readonly when toggling SQL mode), because Record
 * reloads its initial values whenever it receives new props.
 */
class RawFieldEditor extends Component {
    static template = "nl_dev_tools.RawFieldEditor";
    static components = { Record, Field };
    static props = {
        field: Object,
        value: { optional: true },
        resModel: String,
        readonly: Boolean,
        onLoaded: Function,
        onChanged: Function,
    };

    setup() {
        const { field, value } = this.props;
        this.widget = WIDGETS[field.type];
        this.fields = {
            [field.name]: {
                name: field.name,
                type: field.type,
                string: field.string,
                relation: field.relation,
                selection: field.selection,
                digits: field.digits,
                readonly: false,
                required: false,
            },
        };
        this.values = { [field.name]: value };
        this.activeFields = {
            [field.name]:
                field.type === "many2many"
                    ? {
                          related: {
                              activeFields: { display_name: {} },
                              fields: { display_name: { name: "display_name", type: "char" } },
                          },
                      }
                    : {},
        };
        this.hooks = {
            onRootLoaded: (record) => this.props.onLoaded(field.name, record),
            onRecordChanged: (record) => this.props.onChanged(field.name, record),
        };
    }
}

class RawFieldRow extends Component {
    static template = "nl_dev_tools.RawFieldRow";
    static components = { RawFieldEditor };
    static props = {
        field: Object,
        value: { optional: true },
        resModel: String,
        sqlMode: Boolean,
        dirty: Boolean,
        hidden: Boolean,
        revision: Number,
        onLoaded: Function,
        onChanged: Function,
        onReset: Function,
    };

    get readonly() {
        return this.props.sqlMode && !this.props.field.sql_editable;
    }

    get displayValue() {
        return displayValue(this.props.field, this.props.value);
    }

    get badges() {
        const { flags, editable, sql_editable } = this.props.field;
        const badges = [];
        if (flags.computed) {
            badges.push({ label: _t("computed"), cls: "text-bg-info" });
        }
        if (flags.related) {
            badges.push({ label: _t("related"), cls: "text-bg-info" });
        }
        if (flags.readonly) {
            badges.push({ label: _t("readonly"), cls: "text-bg-secondary" });
        }
        if (flags.required) {
            badges.push({ label: _t("required"), cls: "text-bg-danger" });
        }
        if (flags.translate) {
            badges.push({ label: _t("translated"), cls: "text-bg-light border" });
        }
        if (flags.company_dependent) {
            badges.push({ label: _t("company dependent"), cls: "text-bg-light border" });
        }
        if (editable && !sql_editable) {
            badges.push({ label: _t("ORM only"), cls: "text-bg-warning" });
        }
        return badges;
    }
}

export class RawRecordEditorDialog extends Component {
    static template = "nl_dev_tools.RawRecordEditorDialog";
    static components = { Dialog, RawFieldRow };
    static props = {
        resModel: String,
        resId: Number,
        hasUnsavedChanges: Boolean,
        onSaved: Function,
        close: Function,
    };

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.state = useState({
            search: "",
            sqlMode: false,
            saving: false,
            error: null,
            revisions: {},
            dirty: {},
        });
        // Rows load (and reload, on reset or SQL toggle) while this dialog is
        // rendering, so these must stay non-reactive: writing reactive state
        // from a child's load restarts the render and loops forever.
        // field name -> standalone Record
        this.records = {};
        // field name -> serialized value at load time
        this.initialValues = {};
        this.onRowLoaded = this.onRowLoaded.bind(this);
        this.onRowChanged = this.onRowChanged.bind(this);
        this.onRowReset = this.onRowReset.bind(this);

        onWillStart(async () => {
            this.data = await this.orm.call(EDITOR_MODEL, "get_record", [
                this.props.resModel,
                this.props.resId,
            ]);
            this.fieldsByName = Object.fromEntries(this.data.fields.map((f) => [f.name, f]));
        });
    }

    get title() {
        return _t("Edit Raw Record: %(model)s(%(id)s)", {
            model: this.props.resModel,
            id: this.props.resId,
        });
    }

    get dirtyCount() {
        return Object.values(this.state.dirty).filter(Boolean).length;
    }

    currentValue(name) {
        return serializeValue(this.fieldsByName[name].type, this.records[name].data[name]);
    }

    isChanged(name) {
        return JSON.stringify(this.currentValue(name)) !== JSON.stringify(this.initialValues[name]);
    }

    /** Changed fields as {name: serialized value}. */
    getChanges() {
        const changes = {};
        for (const name in this.records) {
            if (this.isChanged(name)) {
                changes[name] = this.currentValue(name);
            }
        }
        return changes;
    }

    isHidden(field) {
        const search = this.state.search.trim().toLowerCase();
        return Boolean(
            search &&
                !field.name.toLowerCase().includes(search) &&
                !(field.string || "").toLowerCase().includes(search)
        );
    }

    onRowLoaded(name, record) {
        this.records[name] = record;
        // a row reloads with its original value, so its first load is the baseline
        if (!(name in this.initialValues)) {
            this.initialValues[name] = this.currentValue(name);
        }
    }

    onRowChanged(name) {
        this.state.dirty[name] = this.isChanged(name);
    }

    onRowReset(name) {
        this.state.dirty[name] = false;
        this.state.revisions[name] = (this.state.revisions[name] || 0) + 1;
    }

    onToggleSqlMode(ev) {
        this.state.sqlMode = ev.target.checked;
        this.state.error = null;
        if (this.state.sqlMode) {
            for (const name in this.state.dirty) {
                if (this.state.dirty[name] && !this.fieldsByName[name].sql_editable) {
                    this.onRowReset(name);
                }
            }
        }
    }

    async onSave() {
        const changes = this.getChanges();
        if (!Object.keys(changes).length) {
            this.props.close();
            return;
        }
        const mode = this.state.sqlMode ? "sql" : "orm";
        this.state.saving = true;
        this.state.error = null;
        try {
            const result = await this.orm.call(EDITOR_MODEL, "save_record", [
                this.props.resModel,
                this.props.resId,
                changes,
                mode,
            ]);
            this.notification.add(
                _t("%(count)s field(s) saved (%(mode)s)", {
                    count: result.fields.length,
                    mode: mode.toUpperCase(),
                }),
                { type: "success" }
            );
            await this.props.onSaved();
            this.props.close();
        } catch (error) {
            this.state.error = error.data?.message || error.message || String(error);
        } finally {
            this.state.saving = false;
        }
    }
}
