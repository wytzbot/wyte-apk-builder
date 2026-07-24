import { getAllBuilds, updateBuild, deleteBuild, exportHistory, importHistory } from './store.js';
import { toast, confirmDialog, promptDialog } from './ui.js';
import { haptic } from './settings.js';

let state = { query: "", sort: "newest", onlyFavorites: false };

function formatBytes(bytes) {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function filteredSortedBuilds() {
  let builds = getAllBuilds();

  if (state.onlyFavorites) builds = builds.filter((b) => b.favorite);

  if (state.query.trim()) {
    const q = state.query.toLowerCase();
    builds = builds.filter(
      (b) => b.appName?.toLowerCase().includes(q) || b.packageName?.toLowerCase().includes(q) || b.notes?.toLowerCase().includes(q)
    );
  }

  const sorters = {
    newest: (a, b) => (b.generatedAt || 0) - (a.generatedAt || 0),
    oldest: (a, b) => (a.generatedAt || 0) - (b.generatedAt || 0),
    name: (a, b) => (a.appName || "").localeCompare(b.appName || ""),
    size: (a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0)
  };
  return builds.sort(sorters[state.sort] || sorters.newest);
}

export function renderHistory() {
  const listEl = document.getElementById("historyList");
  const emptyEl = document.getElementById("historyEmpty");
  const builds = filteredSortedBuilds();

  emptyEl.classList.toggle("hidden", builds.length > 0);
  listEl.innerHTML = builds
    .map(
      (b) => `
    <div class="glass rounded-xl p-4 flex items-start justify-between gap-3" data-run-id="${b.runId}">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-semibold truncate">${escapeHtml(b.appName || "Untitled")}</span>
          ${b.favorite ? '<span title="Favorite">⭐</span>' : ""}
        </div>
        <p class="text-xs text-gray-400 truncate">${escapeHtml(b.packageName || "")} · v${escapeHtml(b.versionName || "?")} · ${formatBytes(b.sizeBytes)}</p>
        <p class="text-xs text-gray-500">${b.generatedAt ? new Date(b.generatedAt).toLocaleString() : ""}</p>
        ${b.notes ? `<p class="text-xs text-indigo-300 mt-1 truncate">📝 ${escapeHtml(b.notes)}</p>` : ""}
      </div>
      <div class="flex flex-col gap-1 shrink-0">
        <button data-action="favorite" class="text-xs bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded-lg">${b.favorite ? "Unfavorite" : "Favorite"}</button>
        <button data-action="duplicate" class="text-xs bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded-lg">Duplicate</button>
        <button data-action="note" class="text-xs bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded-lg">Note</button>
        <button data-action="open" class="text-xs bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded-lg">Open</button>
        <button data-action="delete" class="text-xs bg-red-950 text-red-300 hover:bg-red-900 px-2 py-1 rounded-lg">Delete</button>
      </div>
    </div>`
    )
    .join("");
}

function escapeHtml(str = "") {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function initHistoryScreen({ onOpenRun, onDuplicate }) {
  document.getElementById("historySearch").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderHistory();
  });
  document.getElementById("historySort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderHistory();
  });
  document.getElementById("historyFavoritesOnly").addEventListener("change", (e) => {
    state.onlyFavorites = e.target.checked;
    renderHistory();
  });
  document.getElementById("historyExportBtn").addEventListener("click", () => {
    const blob = new Blob([exportHistory()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wyte-build-history.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
  document.getElementById("historyImportInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const count = importHistory(await file.text());
      toast(`Imported. History now has ${count} build(s).`, "success");
      renderHistory();
    } catch (err) {
      toast(`Import failed: ${err.message}`, "error");
    }
    e.target.value = "";
  });

  document.getElementById("historyList").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const card = e.target.closest("[data-run-id]");
    const runId = card.dataset.runId;
    haptic();

    if (btn.dataset.action === "favorite") {
      const builds = getAllBuilds();
      const build = builds.find((b) => String(b.runId) === runId);
      updateBuild(runId, { favorite: !build.favorite });
      renderHistory();
    } else if (btn.dataset.action === "delete") {
      const ok = await confirmDialog({
        title: "Delete build?",
        message: "This removes it from your local history only. The GitHub Actions run itself won't be deleted.",
        confirmLabel: "Delete",
        danger: true
      });
      if (ok) {
        deleteBuild(runId);
        renderHistory();
        toast("Build removed from history.", "success");
      }
    } else if (btn.dataset.action === "note") {
      const build = getAllBuilds().find((b) => String(b.runId) === runId);
      const note = await promptDialog({ title: "Add a note", message: "Shown on this build's card.", defaultValue: build?.notes || "" });
      if (note !== null) {
        updateBuild(runId, { notes: note });
        renderHistory();
      }
    } else if (btn.dataset.action === "duplicate") {
      const build = getAllBuilds().find((b) => String(b.runId) === runId);
      onDuplicate?.(build);
    } else if (btn.dataset.action === "open") {
      onOpenRun?.(runId);
    }
  });
}
