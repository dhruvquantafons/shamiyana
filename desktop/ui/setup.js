const $ = (id) => document.getElementById(id);

$("form").onsubmit = async (event) => {
  event.preventDefault();
  $("error").textContent = "";
  // The app's own rules (app/lib/password-policy.ts, default length 10).
  const password = $("password").value;
  const local = $("email").value.split("@")[0].toLowerCase();
  if (
    password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password) ||
    (local.length >= 3 && password.toLowerCase().includes(local))
  ) {
    $("error").textContent =
      "Use at least 10 characters with upper- and lowercase letters, a number and a symbol, not containing your email name.";
    return;
  }
  if (password !== $("confirm").value) {
    $("error").textContent = "The passwords do not match.";
    return;
  }
  $("submit").disabled = true;
  const result = await window.shamiyana.createAdmin({
    name: $("name").value.trim(),
    email: $("email").value.trim(),
    password: $("password").value,
  });
  if (!result.ok) {
    $("submit").disabled = false;
    $("error").textContent = result.reason;
  }
};
