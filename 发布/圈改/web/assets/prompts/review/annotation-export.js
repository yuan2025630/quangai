export const KIND_LABELS = {
  change: "修改",
  preserve: "保留",
  move: "移动",
  reference: "参考",
};
export const STATUS_LABELS = {
  pending: "待核对",
  accepted: "已满意",
  changes: "还需修改",
  deferred: "暂缓",
};

export function exportAnnotations(project, scope = "pending") {
  if (scope === "all") return project.annotations;
  const selected = project.annotations.filter(
    (note) =>
      note.kind === "preserve" ||
      (note.kind !== "reference" &&
        (note.status === "pending" || note.status === "changes")),
  );
  const ids = new Set(selected.map((note) => note.id));
  return project.annotations.filter(
    (note) =>
      ids.has(note.id) ||
      (note.kind === "reference" && (!note.targetId || ids.has(note.targetId))),
  );
}
