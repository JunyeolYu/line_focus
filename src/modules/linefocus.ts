export { initLineFocus };

function initLineFocus() {
  Zotero.Reader.registerEventListener("renderToolbar", (event) => {
    const { reader, doc, append } = event;

    let rulerElement: HTMLDivElement | null = null;
    let viewerContainer: HTMLDivElement | null = null;
    let mouseMoveHandler: ((event: MouseEvent) => void) | null = null;
    let isOn = false;

    const button = ztoolkit.UI.createElement(doc, "button", {
      namespace: "html",
      id: "toggle-line-focus",
      classList: ["toolbar-button", `${addon.data.config.addonRef}-reader-button`],
      properties: { tabIndex: -1, title: "Toggle Line Focus" },
      listeners: [
        {
          type: "click",
          listener: (e: MouseEvent) => {
            isOn = !isOn;
            (e.target as HTMLButtonElement).textContent = isOn ? "On" : "Off";

            const hostDoc = reader._iframe?.contentDocument;
            if (!hostDoc) { return; }

            const viewerIframe = hostDoc.querySelector<HTMLIFrameElement>('#primary-view > iframe');
            if (!viewerIframe) { return; }

            const pdfDoc = viewerIframe.contentDocument;
            if (!pdfDoc) { return; }

            if (isOn) {
              viewerContainer = pdfDoc.querySelector<HTMLDivElement>('#viewer');
              if (!viewerContainer) { return; }

              rulerElement = pdfDoc.createElement("div");
              rulerElement.id = "reading-ruler";
              
              // --- STYLE INJECTION START ---
              // Apply styles directly to the element
              rulerElement.style.position = 'absolute';
              rulerElement.style.left = '0';
              rulerElement.style.width = '100%';
              rulerElement.style.height = '25px';
              rulerElement.style.backgroundColor = 'rgba(255, 0, 0, 0.5)'; // Red color
              rulerElement.style.pointerEvents = 'none';
              rulerElement.style.zIndex = '999';
              // --- STYLE INJECTION END ---

              if (pdfDoc.defaultView && pdfDoc.defaultView.getComputedStyle(viewerContainer).position === 'static') {
                viewerContainer.style.position = 'relative';
              }
              
              viewerContainer.appendChild(rulerElement);

              mouseMoveHandler = (moveEvent: MouseEvent) => {
                if (rulerElement && viewerContainer) {
                  const containerRect = viewerContainer.getBoundingClientRect();
                  const y = moveEvent.clientY - containerRect.top;
                  const rulerHeight = rulerElement.offsetHeight;
                  rulerElement.style.top = `${y - rulerHeight / 2}px`;
                }
              };
              viewerContainer.addEventListener("mousemove", mouseMoveHandler);
            } else {
              const container = pdfDoc.querySelector<HTMLDivElement>('#viewer');
              if (container && mouseMoveHandler) {
                container.removeEventListener("mousemove", mouseMoveHandler);
                mouseMoveHandler = null;
              }
              const ruler = container?.querySelector<HTMLDivElement>('#reading-ruler');
              if (ruler) {
                ruler.remove();
                rulerElement = null;
              }
            }
          },
        },
      ],
      enableElementRecord: false,
    });
    (button as HTMLButtonElement).textContent = isOn ? "On" : "Off";
    append(button);
  }, addon.data.config.addonID);
}
