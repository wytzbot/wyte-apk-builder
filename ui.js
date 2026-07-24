const container = () => document.getElementById("toastContainer");

export function toast(message, type = "info", duration = 4000) {
  const el = document.createElement("div");
  const palette = {
    info: "bg-gray-800 border-gray-700",
    success: "bg-green-900/90 border-green-700",
    error: "bg-red-900/90 border-red-700"
  };
  el.className = `pointer-events-auto max-w-sm w-full text-sm text-white border rounded-xl px-4 py-3 shadow-lg animate-toastIn ${palette[type] || palette.info}`;
  el.textContent = message;
  container().appendChild(el);

  setTimeout(() => {
    el.classList.add("animate-toastOut");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, duration);
}

export function confirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
  return openDialog({ title, message, confirmLabel, cancelLabel, danger, withInput: false }).then((r) => r.confirmed);
}

export function promptDialog({ title, message, defaultValue = "", confirmLabel = "Save", cancelLabel = "Cancel" }) {
  return openDialog({ title, message, confirmLabel, cancelLabel, danger: false, withInput: true, defaultValue }).then((r) =>
    r.confirmed ? r.value : null
  );
}

function openDialog({ title, message, confirmLabel, cancelLabel, danger, withInput, defaultValue = "" }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("dialogOverlay");
    document.getElementById("dialogTitle").textContent = title;
    document.getElementById("dialogMessage").textContent = message;

    const input = document.getElementById("dialogInput");
    input.classList.toggle("hidden", !withInput);
    input.value = defaultValue;
    if (withInput) setTimeout(() => input.focus(), 50);

    const confirmBtn = document.getElementById("dialogConfirmBtn");
    const cancelBtn = document.getElementById("dialogCancelBtn");
    confirmBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;
    confirmBtn.className = `flex-1 px-4 py-3 rounded-xl font-semibold ${danger ? "bg-red-600 hover:bg-red-500" : "bg-indigo-600 hover:bg-indigo-500"}`;

    function cleanup(confirmed) {
      overlay.classList.add("hidden");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      resolve({ confirmed, value: input.value });
    }
    function onConfirm() { cleanup(true); }
    function onCancel() { cleanup(false); }

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    overlay.classList.remove("hidden");
  });
}
