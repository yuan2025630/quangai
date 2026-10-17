import {
  exportModeInstructions,
  exportDeliveryInstruction,
} from "../review/instruction-mode.js";

export function buildAgentPrompt(folder, mode = "project") {
  const path = (name) => `${folder.replace(/[\\/]+$/, "")}\\${name}`;
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  return [
    "请处理这份圈改修改单（提示词版本 2）。本地协作目录已经展开，无需解压：",
    folder,
    "",
    `先读取 ${path("instructions.md")} 和 annotations.json，再查看 original.png、对应标注图、crops/ 与适用参考图。`,
    "instructions.md 包含本轮范围和用户原文；逐条理解对象、程度和保留要求，不擅自扩大为全图/整页重设计。已满意项保持，暂缓项不执行，参考只用于明确关联或原文明示的用途。",
    "圈选用于定位；非矩形以实际轮廓为准，局部图中的其他内容不是新增修改任务。信息不明或要求冲突时只澄清受影响项，继续处理可确定的独立项。",
    "",
    exportModeInstructions(mode),
    "",
    `若本轮有明确修改任务：${exportDeliveryInstruction(mode)}`,
    "若本轮仅有保留或参考材料且没有明确修改要求，不强行生成或提交新图，按 instructions.md 处理。",
    "逐项报告编号、完成/部分完成/未完成、实际修改与验证结果。不得覆盖本包输入材料；没有真实修改结果时不要提交原图或标注图冒充完成。",
    "",
    "完成明确修改任务并生成真实成品或核对预览后，使用 PowerShell 提交（替换成你实际生成的 PNG 绝对路径）：",
    "```powershell",
    `python ${quote(path("submit_result.py"))} '成品或核对预览的绝对路径.png'`,
    "```",
    `脚本会完整写入 ${path("result\\revised.png")} 再写回传标记；圈改仍连接本轮目录时会自动载入供用户核对。若无法运行 Python，按 instructions.md 的先 PNG 后 ready.json 协议回传。`,
  ].join("\n");
}
