import { config } from "../../package.json";

const PREF_KEY = `extensions.${config.addonRef}.rulerColor`;
const DEFAULT_COLOR = 'rgba(255, 255, 0, 0.4)';

export async function registerPrefsScripts(win: Window) {
  const doc = win.document;
  const colorContainer = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-color-container`
  );
  if (!colorContainer) return;

  const colorBoxes = Array.from(
    colorContainer.querySelectorAll(".color-box")
  ) as HTMLDivElement[];

  // Function to update the UI based on the preference
  const updateSelection = () => {
    const currentColor = Zotero.Prefs.get(PREF_KEY, true) || DEFAULT_COLOR;
    colorBoxes.forEach((box) => {
      if (box.dataset.color === currentColor) {
        box.classList.add("selected");
      } else {
        box.classList.remove("selected");
      }
    });
  };

  // Add click listeners to each color box
  colorBoxes.forEach((box) => {
    box.addEventListener("click", () => {
      const newColor = box.dataset.color;
      if (newColor) {
        Zotero.Prefs.set(PREF_KEY, newColor, true);
        updateSelection();
      }
    });
  });

  // Initial selection update
  updateSelection();
}
