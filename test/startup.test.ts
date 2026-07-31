import { assert } from "chai";
import { config } from "../package.json";

const paneID = `zotero-prefpane-${config.addonRef}`;
const colorContainerID = `${paneID}-color-container`;

function getPreferencePane() {
  return Zotero.PreferencePanes.pluginPanes.find(
    ({ pluginID }) => pluginID === config.addonID,
  );
}

describe("startup", function () {
  it("should have plugin instance defined", function () {
    assert.isNotEmpty(Zotero[config.addonInstance]);
  });

  it("should register the preference pane", function () {
    const pane = getPreferencePane();

    assert.exists(pane);
    assert.equal(pane?.id, paneID);
    assert.match(pane?.src ?? "", /content\/preferences\.xhtml$/);
  });

  it("should display and load the preference pane", async function () {
    const preferencesWindow = (
      Zotero.Utilities.Internal as typeof Zotero.Utilities.Internal & {
        openPreferences: (paneID: string) => Window;
      }
    ).openPreferences(paneID);

    try {
      if (preferencesWindow.document.readyState !== "complete") {
        await new Promise<void>((resolve) => {
          preferencesWindow.addEventListener("load", () => resolve(), {
            once: true,
          });
        });
      }

      for (let attempt = 0; attempt < 50; attempt++) {
        if (preferencesWindow.document.getElementById(colorContainerID)) {
          break;
        }
        await Zotero.Promise.delay(20);
      }

      assert.exists(
        preferencesWindow.document.querySelector(
          `richlistitem[value="${paneID}"]`,
        ),
        "preference pane should be listed in the navigation",
      );
      assert.exists(
        preferencesWindow.document.getElementById(colorContainerID),
        "preference pane content should be loaded",
      );
      assert.exists(
        preferencesWindow.document.querySelector(
          `#${colorContainerID} .color-box.selected`,
        ),
        "saved color should be selected when the pane loads",
      );
    } finally {
      preferencesWindow.close();
    }
  });
});
