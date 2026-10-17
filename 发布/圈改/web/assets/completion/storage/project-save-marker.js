import { projectContents } from "../review/project-save-state.js?version=0.1.11";

const KEY = "quangai.lastSavedProject";
export function createProjectSaveMarker(storage, crypto) {
  async function fingerprint(project) {
    const bytes = new TextEncoder().encode(
      JSON.stringify(projectContents(project)),
    );
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(hash, (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
  }
  return {
    clear() {
      storage.removeItem(KEY);
    },
    async matches(project) {
      const saved = storage.getItem(KEY);
      return saved !== null && saved === (await fingerprint(project));
    },
    async write(project) {
      storage.setItem(KEY, await fingerprint(project));
    },
  };
}
