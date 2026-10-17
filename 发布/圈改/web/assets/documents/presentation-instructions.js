import { exportAnnotations } from '../prompts/review/annotation-export.js';
import { presentationPages } from './presentation-project.js?version=20261013-projects';

export function targetedPresentationPages(project, scope = 'pending') {
  return presentationPages(project, scope, exportAnnotations).filter(page => page.notes.some(note =>
    ['change', 'move'].includes(note.kind) && ['pending', 'changes'].includes(note.status)));
}

function presentationExtension(project) {
  return /\.pptx$/i.test(project.presentation.fileName) ? '.pptx' : '.ppt';
}

export function buildPresentationInstructions(project, scope, buildImageInstructions) {
  const pages = targetedPresentationPages(project, scope);
  const deck = project.presentation;
  const extension = presentationExtension(project);
  const lines = [`# ${project.title}`, '', '## 修改入口与文件定位',
    '所有相对路径均以本 instructions.md 所在的协作目录为基准，与 AI 当前打开的工作区无关。ZIP 请先解压，再以解压目录为基准。',
    `原演示文稿：${deck.fileName}；可编辑副本：source/original${extension}。`,
    `实际修改入口：打开 source/original${extension}，先另存为 result/revised${extension}，再修改另存的完整文稿；result/ 不存在时先创建。`,
    'project.quangai.json 是圈改的标注快照，pages/ 下的 PNG 是定位预览；PPT 内容修改发生在上述可编辑文稿中。',
    `原 PPT SHA-256：${deck.sha256}`, `总页数：${deck.pages.length}。本轮只修改第 ${pages.length ? pages.map(page => page.number).join('、') : '（无）'} 页。`,
    '只执行以下指定页的待核对/还需修改项。没有列出的页面保持内容、样式和顺序；不删除或新增页面，不把局部修改扩大为整套 PPT 重设计。',
    '优先通过页面 ID（SlideID）定位，页码用于核对原始顺序。页面 ID 不匹配或目标不存在时说明具体页，不猜测或修改其他页。',
    '交付完整、可编辑的修改后 PPT，保留未指定页面。提供每个指定页的实际渲染 PNG，供圈改核对；不要把标注框写入 PPT 或用截图替换可编辑对象。',
    `输入的源文件和预览作为原始材料保留。成品保存为 result/revised${extension}；目标页预览保存为 result/pages/page-NNN.png，NNN 使用原始页码补足三位。逐项验证写入 result/change-report.md。`,
    '交付前重新打开成品检查总页数、顺序和 SlideID，并实际渲染目标页检查布局、字体、遮挡和保留区域；无法执行的检查如实列出。',
    '在圈改中通过“导入修改稿”选择修改后的完整 PPT，程序按页面 ID 配对核对。', ''];
  if (!pages.length) lines.push('没有明确的待修改页。先补充修改意见，不把保留或参考项当作修改任务。');
  for (const page of pages) {
    const prefix = `pages/page-${String(page.number).padStart(3, '0')}/`;
    lines.push(`## 第 ${page.number} 页 · 页面 ID ${page.slideId} · ${page.title}`, `对应原始页：${prefix}original.png；标注：${prefix}annotated.png。`, '');
    const detail = buildImageInstructions(page.project, scope, 'project', 'archive').split('## 交付与验收')[0]
      .replaceAll('reference-annotated.png', prefix + 'reference-annotated.png')
      .replaceAll(/(?<![\w/-])reference\.png/g, prefix + 'reference.png')
      .replaceAll(/(?<![\w/-])annotated\.png/g, prefix + 'annotated.png')
      .replaceAll(/(?<![\w/-])original\.png/g, prefix + 'original.png')
      .replaceAll(/(?<![\w/-])revised\.png/g, prefix + 'revised.png')
      .replaceAll('crops/', prefix + 'crops/');
    lines.push(detail, '');
  }
  return lines.join('\n');
}

export function presentationAgentPrompt(project, folder = '.') {
  const pages = targetedPresentationPages(project).map(page => `第 ${page.number} 页（页面 ID ${page.slideId}）`).join('、');
  const extension = presentationExtension(project);
  const separator = folder.includes('\\') || /^[a-z]:/i.test(folder) ? '\\' : '/';
  const path = name => `${folder.replace(/[\\/]+$/, '')}${separator}${name.replaceAll('/', separator)}`;
  return [
    `请实际修改 PPT「${project.title || project.presentation.fileName}」。`,
    `协作目录：${folder}`,
    '路径以此协作目录为准，即使你当前打开了其他工程，也按下面的文件位置处理。本目录已经展开；若收到 ZIP，先解压后以解压位置为准。',
    '',
    '1. 读取本轮修改要求与页码映射：',
    path('instructions.md'), path('annotations.json'),
    '2. 打开要修改的可编辑 PPT：',
    path(`source/original${extension}`),
    `源文件 SHA-256：${project.presentation.sha256}`,
    `先另存为 ${path(`result/revised${extension}`)}（目录不存在时先创建），实际修改另存文稿中的文字、形状、图片与布局。`,
    'project.quangai.json 只保存圈改标注；pages/ 下的 original.png、annotated.png 和 crops/ 只用于定位与核对。不要把这些文件当作 PPT 源文件，也不要修改圈改程序源码。',
    '',
    `目标页概览：${pages || '以本轮 instructions.md 和 annotations.json 明确列出的页为准'}。`,
    '实际执行范围以本轮已导出的 instructions.md 与 annotations.json 为准；导出后新增的意见需重新导出。先按 SlideID 定位，再核对原始页码和标题；ID 不匹配时说明问题，不猜测其他页。',
    `定位预览目录：${path('pages/')}，每页位于 page-NNN/（NNN 是补足三位的原始页码）。`,
    '按用户原文逐项修改，保留未指定页、页面顺序、SlideID 和原有可编辑对象；不要用截图替代整页内容。',
    '',
    '交付路径：',
    `完整可编辑 PPT：${path(`result/revised${extension}`)}`,
    `目标页实际渲染 PNG：${path('result/pages/page-NNN.png')}`,
    `逐项修改与验证报告：${path('result/change-report.md')}`,
    '重新打开成品核验页数、顺序与 SlideID，渲染目标页检查文字、布局、遮挡及保留要求；未能完成的检查如实报告。保留全部输入材料。',
    '完成后给出成品绝对路径，用户在圈改点击“导入修改稿”选择完整 PPT 核对。',
  ].join('\n');
}
