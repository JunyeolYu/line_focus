import { config } from "../../package.json";

const PREF_KEY = `extensions.${config.addonRef}.rulerColor`;
const DEFAULT_COLOR = 'rgba(255, 255, 0, 0.4)';

export { initLineFocus };

function initLineFocus() {
  Zotero.Reader.registerEventListener("renderToolbar", (event) => {
    const { reader, doc, append } = event;

    let rulerElement: HTMLDivElement | null = null;
    let mouseOverHandler: ((event: MouseEvent) => void) | null = null;
    let mouseOutHandler: ((event: MouseEvent) => void) | null = null;
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
            
            const viewerContainer = pdfDoc.querySelector<HTMLDivElement>('#viewer');
            if (!viewerContainer) { return; }

            if (isOn) {
              rulerElement = pdfDoc.createElement("div");
              rulerElement.id = "reading-ruler";
              
              const savedColor = Zotero.Prefs.get(PREF_KEY, true) || DEFAULT_COLOR;

              rulerElement.style.position = 'absolute';
              rulerElement.style.backgroundColor = savedColor;
              rulerElement.style.pointerEvents = 'none';
              rulerElement.style.zIndex = '9999';
              rulerElement.style.display = 'none';
              rulerElement.style.borderRadius = '2px';

              if (pdfDoc.defaultView && pdfDoc.defaultView.getComputedStyle(viewerContainer).position === 'static') {
                viewerContainer.style.position = 'relative';
              }
              viewerContainer.appendChild(rulerElement);

              mouseOverHandler = (moveEvent: MouseEvent) => {
                const target = moveEvent.target as HTMLElement;
                if (rulerElement && target.nodeName === 'SPAN' && target.closest('.textLayer')) {
                  const lineSpans: HTMLElement[] = [target];
                  const targetRect = target.getBoundingClientRect();
                  const targetTop = targetRect.top;
                  const tolerance = targetRect.height / 2; // Allow for small vertical misalignments

                  // Traverse backwards
                  let currentSpan = target.previousElementSibling as HTMLElement;
                  while (currentSpan && currentSpan.nodeName === 'SPAN') {
                    const rect = currentSpan.getBoundingClientRect();
                    if (Math.abs(rect.top - targetTop) < tolerance) {
                      lineSpans.unshift(currentSpan);
                    } else {
                      break;
                    }
                    currentSpan = currentSpan.previousElementSibling as HTMLElement;
                  }

                  // Traverse forwards
                  currentSpan = target.nextElementSibling as HTMLElement;
                  while (currentSpan && currentSpan.nodeName === 'SPAN') {
                    const rect = currentSpan.getBoundingClientRect();
                    if (Math.abs(rect.top - targetTop) < tolerance) {
                      lineSpans.push(currentSpan);
                    } else {
                      break;
                    }
                    currentSpan = currentSpan.nextElementSibling as HTMLElement;
                  }

                  // Calculate the bounding box of the entire line
                  const firstSpanRect = lineSpans[0].getBoundingClientRect();
                  const lastSpanRect = lineSpans[lineSpans.length - 1].getBoundingClientRect();
                  const viewerRect = viewerContainer.getBoundingClientRect();

                  const left = firstSpanRect.left - viewerRect.left;
                  const top = firstSpanRect.top - viewerRect.top;
                  const width = lastSpanRect.right - firstSpanRect.left;
                  const height = firstSpanRect.height;

                  rulerElement.style.left = `${left}px`;
                  rulerElement.style.top = `${top}px`;
                  rulerElement.style.width = `${width}px`;
                  rulerElement.style.height = `${height}px`;
                  rulerElement.style.display = 'block';
                }
              };

              mouseOutHandler = () => {
                if (rulerElement) {
                  rulerElement.style.display = 'none';
                }
              };

              viewerContainer.addEventListener("mouseover", mouseOverHandler);
              viewerContainer.addEventListener("mouseout", mouseOutHandler);
            } else {
              // Cleanup
              if (viewerContainer && mouseOverHandler) viewerContainer.removeEventListener("mouseover", mouseOverHandler);
              if (viewerContainer && mouseOutHandler) viewerContainer.removeEventListener("mouseout", mouseOutHandler);
              const ruler = viewerContainer.querySelector<HTMLDivElement>('#reading-ruler');
              if (ruler) ruler.remove();
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
