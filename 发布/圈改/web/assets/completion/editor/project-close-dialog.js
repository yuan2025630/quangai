export function createProjectCloseDialog(document) {
  const dialog = document.createElement("dialog");
  dialog.id = "unsaved-project-dialog";
  dialog.setAttribute("aria-labelledby", "unsaved-project-title");
  dialog.setAttribute("aria-describedby", "unsaved-project-description");
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="unsaved-project-title">项目尚未保存</h2><button type="button" class="icon-button" data-dismiss aria-label="取消关闭项目">×</button></div>
    <p id="unsaved-project-description"></p>
    <div class="dialog-actions"><button type="button" class="button subtle" data-choice="discard">不保存</button><button type="button" class="button primary" data-choice="save" autofocus>保存</button></div>`;
  document.body.append(dialog);
  let resolveChoice = null;
  dialog.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-choice]")?.dataset.choice;
    if (choice) dialog.close(choice);
    else if (event.target.closest("[data-dismiss]")) dialog.close();
  });
  dialog.addEventListener("close", () => {
    const resolve = resolveChoice;
    resolveChoice = null;
    resolve?.(
      ["discard", "save"].includes(dialog.returnValue) ? dialog.returnValue : null,
    );
  });
  return (project, { exiting = false } = {}) =>
    new Promise((resolve) => {
      resolveChoice = resolve;
      dialog.returnValue = "";
      dialog.querySelector("p").textContent = `“${project.title || "未命名修改单"}”有未保存的修改，${exiting ? "退出前" : "关闭前"}是否保存？`;
      dialog.querySelector("[data-dismiss]").setAttribute("aria-label", exiting ? "取消退出" : "取消关闭项目");
      dialog.showModal();
    });
}
