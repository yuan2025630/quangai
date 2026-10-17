export function showCopySuccess(button) {
  if (!button.dataset.copyLabel) button.dataset.copyLabel = button.innerHTML;
  clearTimeout(button.copyFeedbackTimer);
  button.textContent = '复制成功';
  button.setAttribute('aria-live', 'polite');
  button.copyFeedbackTimer = setTimeout(() => {
    button.innerHTML = button.dataset.copyLabel;
  }, 2000);
}
