import { config } from "../../package.json";

const PREFERENCE_PANE_ID = `zotero-prefpane-${config.addonRef}`;

export function registerPreferencePane() {
  return Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    id: PREFERENCE_PANE_ID,
    src: rootURI + "content/preferences.xhtml",
    label: "Line Focus",
    stylesheets: [rootURI + "content/preferences.css"],
  });
}
