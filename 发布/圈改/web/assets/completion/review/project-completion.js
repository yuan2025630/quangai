export function completionFields(project) {
  const completedAt = project.completedAt ?? null;
  if (
    completedAt !== null &&
    (typeof completedAt !== "string" ||
      !Number.isFinite(Date.parse(completedAt)) ||
      new Date(completedAt).toISOString() !== completedAt)
  ) {
    throw new Error("项目完成时间无效。");
  }
  return { completedAt };
}

export function completedProject(project, now) {
  if (!project.images.original) throw new Error("请先导入原图。");
  return { ...project, completedAt: now.toISOString() };
}

/** Completing a project saves its snapshot and leaves its tab available. */
export function createProjectCompletion({
  getProject,
  isBusy,
  runBusy,
  saveFile,
  markSaved,
  now,
  onSaved,
  setCompletedProject,
}) {
  let pending = false;
  return {
    get pending() {
      return pending;
    },
    async complete() {
      if (pending || isBusy() || !getProject().images.original) return;
      const current = getProject();
      const snapshot = completedProject(current, now());
      pending = true;
      try {
        await runBusy(async () => {
          const saved = await saveFile(snapshot);
          if (saved.cancelled) return;
          if (getProject() !== current) {
            onSaved({ ...saved, currentChanged: true });
            return;
          }
          setCompletedProject?.(snapshot);
          await markSaved(getProject());
          onSaved(saved);
        });
      } finally {
        pending = false;
      }
    },
  };
}
