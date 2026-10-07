const $ = (id) => document.getElementById(id);
window.shamiyana.onStatus((message) => { $("status").textContent = `${message}…`; });
window.shamiyana.onFailed(({ message, logs }) => {
  $("starting").hidden = true;
  $("failed").hidden = false;
  $("message").textContent = message;
  $("logs").textContent = logs;
});
$("retry").onclick = () => window.shamiyana.retry();
$("open-logs").onclick = () => window.shamiyana.openLogs();
