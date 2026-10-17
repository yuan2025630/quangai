import { targetedPresentationPages, presentationAgentPrompt } from './presentation-instructions.js?version=20261017-ppt-preview-final';
import { syncPresentationProject } from './presentation-project.js?version=20261013-projects';

export function installPresentationExport({ request, library, getProject, isBusy, runBusy, scope, buildInstructions, annotateImage, cropImage, commitProject, notify, showError }) {
  async function currentExport() {
    const project = getProject();
    const folder = project.presentation.exportFolder;
    if (!folder) throw new Error('请先导出当前 PPT 的协作目录或 ZIP 修改包。');
    await library.flush();
    const result = await request('resolve-export', { id: project.storageId, folder });
    if (getProject().storageId !== project.storageId || getProject().presentation?.exportFolder !== folder)
      throw new Error('项目已切换，请在当前项目重新操作。');
    if (result.folder !== folder) {
      const current = getProject();
      commitProject({ ...current, presentation: { ...current.presentation, exportFolder: result.folder } });
    }
    return { project: getProject(), folder: result.folder };
  }
  async function exportPresentation(archive) {
    await library.flush();
    const project = syncPresentationProject(getProject()), pages = targetedPresentationPages(project, scope());
    if (!pages.length) throw new Error('当前没有待修改的 PPT 页，请先添加修改意见。');
    const files = [
      { name: 'instructions.md', text: buildInstructions(project, scope()) },
      { name: 'agent-prompt.txt', text: presentationAgentPrompt(project) },
      { name: 'project.quangai.json', text: JSON.stringify(project) },
      { name: 'annotations.json', text: JSON.stringify({ schemaVersion: 1, fileName: project.presentation.fileName,
        sourceSha256: project.presentation.sha256, totalPages: project.presentation.pages.length,
        targetPages: pages.map(page => ({ pageNumber: page.number, slideId: page.slideId, title: page.title,
          image: { width: page.images.original.width, height: page.images.original.height }, annotations: page.notes })) }, null, 2) },
    ];
    const binary = (name, src) => files.push({ name, base64: src.split(',')[1] });
    for (const page of pages) {
      const prefix = `pages/page-${String(page.number).padStart(3, '0')}/`;
      for (const [role, image] of Object.entries(page.images)) {
        if (!image) continue;
        binary(prefix + role + '.png', image.src);
        if (role !== 'revised') binary(prefix + (role === 'original' ? 'annotated.png' : 'reference-annotated.png'), await annotateImage(image, page.notes.filter(note => note.source === role)));
      }
      for (const note of page.notes) binary(`${prefix}crops/${note.number}-${note.kind}.png`, await cropImage(page.images[note.source], note.rect));
    }
    const result = await request('presentation-export', { projectJson: JSON.stringify(project), archive, files });
    commitProject({ ...project, presentation: { ...project.presentation, exportFolder: result.folder } });
    await library.flush();
    document.getElementById('agent-prompt').value = presentationAgentPrompt(project, result.folder);
    notify(`${archive ? 'PPT 修改包' : 'PPT 协作目录'}已保存：${result.archive ?? result.folder}`);
    return result;
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('#download-package,#export-agent,#copy-agent-prompt,#open-agent-folder');
    if (!button || !getProject().presentation) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (isBusy() || button.disabled) return;
    if (button.id === 'copy-agent-prompt') {
      currentExport().then(async ({ project, folder }) => {
        const prompt = presentationAgentPrompt(project, folder);
        document.getElementById('agent-folder').value = folder;
        document.getElementById('agent-prompt').value = prompt;
        try { await navigator.clipboard.writeText(prompt); notify('所选 PPT 修改提示词已复制。'); }
        catch {
          if (getProject().storageId !== project.storageId || getProject().presentation?.exportFolder !== folder) {
            notify('项目已切换，请在当前项目重新复制。'); return;
          }
          document.getElementById('agent-details').open = true; document.getElementById('agent-prompt').focus(); document.getElementById('agent-prompt').select(); notify('已选中当前 PPT 提示词，请按 Ctrl+C。');
        }
      }).catch(showError); return;
    }
    if (button.id === 'open-agent-folder') {
      currentExport().then(({ project, folder }) => request('open-export', { id: project.storageId, folder })).catch(showError); return;
    }
    runBusy(() => exportPresentation(button.id === 'download-package')).catch(showError);
  }, true);
  return { exportPresentation };
}
