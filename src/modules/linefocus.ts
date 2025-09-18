
export { initLineFocus };

function initLineFocus() {
    // Register reader toolbar button
    Zotero.Reader.registerEventListener("renderToolbar", (event) => {
    const { doc, append } = event;
    const menuIcon = `chrome://${addon.data.config.addonRef}/content/skin/focus.png`;
    // per-button boolean state (initially false)
    let isOn = false;

    const button = ztoolkit.UI.createElement(doc, "button", {
        namespace: "html",
        id: "toggle-line-focus",
        classList: [
        "toolbar-button",
        `${addon.data.config.addonRef}-reader-button`,
        ],
        properties: {
        tabIndex: -1,
        title: "Focus!!",
        },
        listeners: [
        {
            type: "click",
            listener: () => {
            // toggle state and update label
            isOn = !isOn;
            (button as HTMLButtonElement).innerHTML = isOn ? "On" : "Off";

            // preserve existing behavior
            addon.hooks.onDialogEvents("lineFocusDialog");
            },
        },
        ],
        enableElementRecord: false,
    });
    // set initial label
    (button as HTMLButtonElement).textContent = isOn ? "On" : "Off";

    append(button);
    },
    addon.data.config.addonID);
}
