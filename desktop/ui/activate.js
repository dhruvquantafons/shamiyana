const $ = (id) => document.getElementById(id);

window.shamiyana.license().then((info) => {
  $("machine-id").textContent = info.machineId;
  $("reason").textContent = info.reason || "";
  $("company").textContent = info.contact.company || "us";
  for (const field of ["email", "phone", "website"]) {
    if (info.contact[field]) {
      $(field).textContent = info.contact[field];
      $(field).hidden = false;
      $("contact").hidden = false;
    }
  }
  $("copy").onclick = async () => {
    await window.shamiyana.copy(info.machineId);
    $("copy").textContent = "Copied";
    setTimeout(() => { $("copy").textContent = "Copy"; }, 1500);
  };
});

$("form").onsubmit = async (event) => {
  event.preventDefault();
  $("error").textContent = "";
  $("submit").disabled = true;
  const result = await window.shamiyana.activate($("key").value);
  $("submit").disabled = false;
  if (!result.ok) $("error").textContent = result.reason;
};
