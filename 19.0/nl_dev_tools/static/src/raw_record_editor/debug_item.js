import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { session } from "@web/session";
import { RawRecordEditorDialog } from "./raw_record_editor";

function editRawRecord({ component, env }) {
    const record = component.model?.root;
    if (!session.dev_tools_enabled || !record?.resId) {
        return null;
    }
    return {
        type: "item",
        description: _t("Edit Raw Record"),
        callback: () => {
            env.services.dialog.add(RawRecordEditorDialog, {
                resModel: record.resModel,
                resId: record.resId,
                hasUnsavedChanges: Boolean(record.dirty),
                onSaved: () => component.model.load(),
            });
        },
        sequence: 115,
        section: "record",
    };
}

registry.category("debug").category("form").add("nl_dev_tools.editRawRecord", editRawRecord);
