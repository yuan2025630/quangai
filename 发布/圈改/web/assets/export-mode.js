const preferenceKey = "quangai.export-mode";

export {
  exportModeInstructions,
  exportDeliveryInstruction,
} from "./prompts/review/instruction-mode.js";

export function selectedExportMode() {
  return (
    document.querySelector('[name="export-mode"]:checked')?.value ?? "project"
  );
}

export function installExportMode(refreshPreview) {
  const options = document.querySelectorAll('[name="export-mode"]');
  try {
    const previous = localStorage.getItem(preferenceKey);
    if (previous === "project" || previous === "image") {
      options.forEach((option) => {
        option.checked = option.value === previous;
      });
    }
  } catch (error) {
    console.warn("无法读取上次的导出方式。", error);
  }
  options.forEach((option) =>
    option.addEventListener("change", () => {
      try {
        localStorage.setItem(preferenceKey, selectedExportMode());
      } catch (error) {
        const warning = document.getElementById("toast");
        warning.textContent =
          "导出方式已切换，但无法保存，下次打开可能不会记住。";
        warning.className = "toast error";
        warning.hidden = false;
        console.warn("无法保存导出方式。", error);
      }
      refreshPreview();
    }),
  );
}
