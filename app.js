/**
 * Wyte Builder - Main Application Core (app.js)
 * ES Module with global scope exposure for inline HTML event handlers.
 */

import {
  CONFIG,
  getGitHubUser,
  exchangeCodeForToken,
  ensureUserFork,
  triggerGitHubAction,
  findRunByBuildId,
  getRun,
  getRunJobs,
  listRunArtifacts,
  downloadArtifactZip,
  runUrl
} from "./data.js";

// --- STATE MANAGEMENT ---
let state = {
  user: null,
  builds: JSON.parse(localStorage.getItem("wyte_builds") || "[]"),
  currentBuild: null,
  currentConfig: null,
  buildInterval: null,
  settings: JSON.parse(localStorage.getItem("wyte_settings") || JSON.stringify({
    theme: "system",
    animations: true,
    haptics: true,
    dataSaver: false
  }))
};

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initSettingsUI();
  checkAuth();
  initNavigation();
  initHistory();
});

// Theme Management
function initTheme() {
  const theme = state.settings.theme;
  const isDark = theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("light-mode", !isDark);

  document.querySelectorAll("[data-theme]").forEach(btn => {
    if (btn.dataset.theme === theme) {
      btn.classList.add("bg-indigo-600");
      btn.classList.remove("bg-gray-900");
    } else {
      btn.classList.remove("bg-indigo-600");
      btn.classList.add("bg-gray-900");
    }
  });
}

function initSettingsUI() {
  const animCheckbox = document.getElementById("settingAnimations");
  if (animCheckbox) {
    animCheckbox.checked = state.settings.animations;
    document.body.classList.toggle("no-animations", !state.settings.animations);
    animCheckbox.addEventListener("change", (e) => {
      state.settings.animations = e.target.checked;
      document.body.classList.toggle("no-animations", !e.target.checked);
      saveSettings();
    });
  }

  const hapticCheckbox = document.getElementById("settingHaptics");
  if (hapticCheckbox) {
    hapticCheckbox.checked = state.settings.haptics;
    hapticCheckbox.addEventListener("change", (e) => {
      state.settings.haptics = e.target.checked;
      saveSettings();
    });
  }

  const dataSaverCheckbox = document.getElementById("settingDataSaver");
  if (dataSaverCheckbox) {
    dataSaverCheckbox.checked = state.settings.dataSaver;
    dataSaverCheckbox.addEventListener("change", (e) => {
      state.settings.dataSaver = e.target.checked;
      saveSettings();
    });
  }

  const clearCacheBtn = document.getElementById("clearCacheBtn");
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener("click", async () => {
      const confirmClear = await showConfirm("Clear Cache?", "This will wipe all local build history and options stored on this client.");
      if (confirmClear) {
        localStorage.clear();
        state.builds = [];
        state.settings = { theme: "system", animations: true, haptics: true, dataSaver: false };
        initTheme();
        initSettingsUI();
        initHistory();
        showToast("Cache cleared", "success");
        logout();
      }
    });
  }
}

function saveSettings() {
  localStorage.setItem("wyte_settings", JSON.stringify(state.settings));
}

// --- AUTHENTICATION & OAUTH FLOW ---
function checkAuth() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get("code");

  if (code) {
    window.history.replaceState({}, document.title, window.location.pathname);
    handleOAuthCallback(code);
    return;
  }

  const token = localStorage.getItem("wyte_github_token");
  if (token) {
    fetchUserInfo(token);
  } else {
    showScreen("welcome");
  }
}

async function handleOAuthCallback(code) {
  showToast("Signing you in...", "info");
  try {
    const token = await exchangeCodeForToken(code);
    localStorage.setItem("wyte_github_token", token);
    await fetchUserInfo(token);
  } catch (error) {
    showAuthError(error.message || "Could not complete GitHub sign-in.");
  }
}

async function fetchUserInfo(token) {
  try {
    state.user = await getGitHubUser(token);
    renderUserUI();
  } catch (e) {
    logout();
  }
}

function renderUserUI() {
  document.getElementById("username").textContent = state.user.name || state.user.login;
  document.getElementById("avatar").src = state.user.avatar_url;
  showScreen("dashboard");
}

function login() {
  triggerHaptic();
  // Same OAuth token is later used to fork the build repo into the user's
  // own account and dispatch builds there — that's why `workflow` scope is requested.
  window.location.href = `https://github.com/login/oauth/authorize?client_id=${CONFIG.CLIENT_ID}&redirect_uri=${encodeURIComponent(CONFIG.REDIRECT_URI)}&scope=repo,workflow`;
}

function logout() {
  triggerHaptic();
  localStorage.removeItem("wyte_github_token");
  state.user = null;
  showScreen("welcome");
  showToast("Logged out successfully", "info");
}

// --- SCREEN NAVIGATION ---
function initNavigation() {
  document.querySelectorAll(".bottom-nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      triggerHaptic();
      showScreen(btn.dataset.nav);
    });
  });

  document.querySelectorAll("[data-theme]").forEach(btn => {
    btn.addEventListener("click", () => {
      triggerHaptic();
      state.settings.theme = btn.dataset.theme;
      saveSettings();
      initTheme();
    });
  });
}

function showScreen(screenId) {
  const screens = ["welcome", "dashboard", "processing", "download", "history", "settingsScreen"];
  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
  });

  const target = document.getElementById(screenId);
  if (target) target.classList.remove("hidden");

  const nav = document.getElementById("bottomNav");
  if (nav) {
    if (screenId === "welcome" || screenId === "processing") {
      nav.classList.add("hidden");
    } else {
      nav.classList.remove("hidden");
      document.querySelectorAll(".bottom-nav-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.nav === screenId);
      });
    }
  }
}

// --- BUILD LOGIC (real GitHub Actions builds, run on the user's own fork) ---
function triggerBuild() {
  triggerHaptic();

  const appName = document.getElementById("appName").value.trim();
  const url = document.getElementById("url").value.trim();
  const packageName = document.getElementById("packageName").value.trim();

  if (!appName || !url || !packageName) {
    showToast("Please fill in all required fields (*)", "warning");
    return;
  }

  const buildId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  state.currentBuild = {
    id: buildId,
    name: appName,
    url: url,
    packageName: packageName,
    version: document.getElementById("versionName").value || "1.0.0",
    date: new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
    favorite: false,
    note: "",
    runId: null,
    runUrl: null,
    artifacts: []
  };

  state.currentConfig = {
    appUrl: url,
    appName,
    packageName,
    versionName: document.getElementById("versionName").value || "1.0.0",
    versionCode: document.getElementById("versionCode").value || "1",
    orientation: document.getElementById("orientation").value,
    themeColor: document.getElementById("themeColor").value,
    backgroundColor: document.getElementById("backgroundColor").value,
    displayMode: document.getElementById("displayMode").value,
    iconUrl: document.getElementById("iconUrl").value.trim(),
    startUrl: document.getElementById("startUrl").value || "/",
    enableNotifications: document.getElementById("enableNotifications").checked,
    fallbackType: document.getElementById("fallbackType").value,
    buildId
  };

  document.getElementById("processingFailed").classList.add("hidden");
  showScreen("processing");
  runRealBuild();
}

async function runRealBuild() {
  const token = localStorage.getItem("wyte_github_token");
  const username = state.user.login;
  const stageList = document.getElementById("stageList");
  const progressSubtitle = document.getElementById("processingSubtitle");
  const elapsedEl = document.getElementById("elapsedTime");
  stageList.innerHTML = "";

  let elapsedSeconds = 0;
  state.buildInterval = setInterval(() => {
    elapsedSeconds++;
    const min = Math.floor(elapsedSeconds / 60);
    const sec = elapsedSeconds % 60;
    elapsedEl.textContent = `Elapsed: ${min}:${sec.toString().padStart(2, "0")}`;
  }, 1000);

  const setStage = (text) => {
    progressSubtitle.textContent = text;
    const li = document.createElement("li");
    li.className = "text-sm text-gray-300 animate-fadeIn flex items-center gap-2";
    li.innerHTML = `<span>✔</span> <span>${text}</span>`;
    stageList.appendChild(li);
  };

  try {
    setStage("Checking your GitHub Actions setup...");
    await ensureUserFork(token, username);

    setStage("Starting the build on your GitHub account...");
    await triggerGitHubAction(state.currentConfig, token, username);

    setStage("Waiting for GitHub to pick up the build...");
    const run = await findRunByBuildId(token, username, state.currentConfig.buildId);
    if (!run) throw new Error("Couldn't find the build on GitHub Actions. Check your fork's Actions tab.");

    state.currentBuild.runId = run.id;
    state.currentBuild.runUrl = runUrl(username, run.id);
    const viewLogsBtn = document.getElementById("viewLogsBtn");
    if (viewLogsBtn) viewLogsBtn.href = state.currentBuild.runUrl;

    setStage("Build running — compiling your APK...");
    await pollRunUntilDone(token, username, run.id, setStage);
  } catch (error) {
    clearInterval(state.buildInterval);
    showBuildFailure(error.message || "Something went wrong starting the build.");
  }
}

async function pollRunUntilDone(token, username, runId, setStage) {
  const seenSteps = new Set();

  while (true) {
    const run = await getRun(token, username, runId);
    const jobs = await getRunJobs(token, username, runId).catch(() => []);

    jobs.forEach(job => {
      (job.steps || []).forEach(step => {
        if (step.status === "completed" && step.conclusion === "success" && !seenSteps.has(step.name)) {
          seenSteps.add(step.name);
          setStage(step.name);
        }
      });
    });

    if (run.status === "completed") {
      clearInterval(state.buildInterval);
      if (run.conclusion === "success") {
        await completeBuild(token, username, runId);
      } else {
        showBuildFailure(`Build ${run.conclusion}. Check the logs on GitHub for details.`);
      }
      return;
    }

    await new Promise(r => setTimeout(r, 5000));
  }
}

function showBuildFailure(message) {
  const failEl = document.getElementById("processingFailed");
  if (failEl) failEl.classList.remove("hidden");
  const subtitle = document.getElementById("processingSubtitle");
  if (subtitle) subtitle.textContent = message;
  showToast(message, "danger");
}

async function completeBuild(token, username, runId) {
  const artifacts = await listRunArtifacts(token, username, runId).catch(() => []);
  state.currentBuild.artifacts = artifacts.map(a => ({ id: a.id, name: a.name, sizeBytes: a.size_in_bytes }));

  state.builds.unshift(state.currentBuild);
  localStorage.setItem("wyte_builds", JSON.stringify(state.builds));

  document.getElementById("downloadAppName").textContent = state.currentBuild.name;
  document.getElementById("dlVersion").textContent = state.currentBuild.version;
  document.getElementById("dlPackage").textContent = state.currentBuild.packageName;
  document.getElementById("dlSize").textContent = artifacts[0]
    ? `${(artifacts[0].size_in_bytes / (1024 * 1024)).toFixed(1)} MB (zipped)`
    : "—";
  document.getElementById("dlDuration").textContent = document.getElementById("elapsedTime").textContent.replace("Elapsed: ", "");
  document.getElementById("dlDate").textContent = state.currentBuild.date;

  const openActionsBtn = document.getElementById("openActionsBtn");
  if (openActionsBtn) openActionsBtn.href = state.currentBuild.runUrl;

  const qrContainer = document.getElementById("qrcode");
  qrContainer.innerHTML = "";
  if (window.QRCode) {
    new window.QRCode(qrContainer, {
      text: state.currentBuild.runUrl,
      width: 128,
      height: 128,
      colorDark: "#0F172A",
      colorLight: "#FFFFFF"
    });
  }

  initHistory();
  showScreen("download");
  showToast("APK successfully generated!", "success");
}

function cancelBuild() {
  triggerHaptic();
  if (state.buildInterval) {
    clearInterval(state.buildInterval);
  }
  showScreen("dashboard");
  showToast("Stopped watching this build (it may still be running on GitHub)", "warning");
}

function retryBuild() {
  document.getElementById("processingFailed").classList.add("hidden");
  showScreen("processing");
  runRealBuild();
}

async function downloadApk() {
  triggerHaptic();
  const build = state.currentBuild;
  if (!build || !build.artifacts || !build.artifacts.length) {
    showToast("No artifact found — opening the build on GitHub instead.", "warning");
    if (build && build.runUrl) window.open(build.runUrl, "_blank");
    return;
  }

  const token = localStorage.getItem("wyte_github_token");
  const username = state.user.login;

  showToast("Fetching your APK...", "info");
  try {
    const blob = await downloadArtifactZip(token, username, build.artifacts[0].id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${build.name}-${build.version}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Downloaded — unzip it to get the APK/AAB file.", "success");
  } catch (error) {
    showToast("Direct download failed — opening on GitHub instead.", "warning");
    window.open(build.runUrl, "_blank");
  }
}

function copyRunLink() {
  triggerHaptic();
  if (state.currentBuild && state.currentBuild.runUrl) {
    navigator.clipboard.writeText(state.currentBuild.runUrl);
    showToast("GitHub Build Actions URL copied!", "success");
  }
}

function shareApk() {
  triggerHaptic();
  if (navigator.share && state.currentBuild && state.currentBuild.runUrl) {
    navigator.share({
      title: state.currentBuild.name,
      text: `Install ${state.currentBuild.name} APK package compiled via Wyte.`,
      url: state.currentBuild.runUrl
    }).catch(() => {});
  } else {
    showToast("Social sharing API unsupported on this profile.", "warning");
  }
}

function deleteCurrentBuild() {
  triggerHaptic();
  state.builds = state.builds.filter(b => b.id !== state.currentBuild.id);
  localStorage.setItem("wyte_builds", JSON.stringify(state.builds));
  initHistory();
  showScreen("dashboard");
  showToast("Compilation record removed", "info");
}

function startNewBuild() {
  triggerHaptic();
  showScreen("dashboard");
}

// --- HISTORY LOGIC ---
function initHistory() {
  const searchInput = document.getElementById("historySearch");
  const sortSelect = document.getElementById("historySort");
  const favoritesCheckbox = document.getElementById("historyFavoritesOnly");

  const filterAndRender = () => {
    let filtered = [...state.builds];
    const query = searchInput ? searchInput.value.toLowerCase().trim() : "";
    const favsOnly = favoritesCheckbox ? favoritesCheckbox.checked : false;

    if (query) {
      filtered = filtered.filter(b =>
        b.name.toLowerCase().includes(query) ||
        b.packageName.toLowerCase().includes(query) ||
        (b.note && b.note.toLowerCase().includes(query))
      );
    }

    if (favsOnly) {
      filtered = filtered.filter(b => b.favorite);
    }

    const sortBy = sortSelect ? sortSelect.value : "newest";
    if (sortBy === "newest") {
      filtered.sort((a, b) => (b.runId || 0) - (a.runId || 0) || String(b.id).localeCompare(String(a.id)));
    } else if (sortBy === "oldest") {
      filtered.sort((a, b) => (a.runId || 0) - (b.runId || 0) || String(a.id).localeCompare(String(b.id)));
    } else if (sortBy === "name") {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    }

    renderHistoryList(filtered);
  };

  if (searchInput) searchInput.addEventListener("input", filterAndRender);
  if (sortSelect) sortSelect.addEventListener("change", filterAndRender);
  if (favoritesCheckbox) favoritesCheckbox.addEventListener("change", filterAndRender);

  const exportBtn = document.getElementById("historyExportBtn");
  if (exportBtn) {
    exportBtn.onclick = () => {
      triggerHaptic();
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.builds, null, 2));
      const dlAnchor = document.createElement('a');
      dlAnchor.setAttribute("href", dataStr);
      dlAnchor.setAttribute("download", "wyte_history_backup.json");
      dlAnchor.click();
      showToast("Backup exported", "success");
    };
  }

  const importInput = document.getElementById("historyImportInput");
  if (importInput) {
    importInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const imported = JSON.parse(event.target.result);
          if (Array.isArray(imported)) {
            state.builds = imported;
            localStorage.setItem("wyte_builds", JSON.stringify(state.builds));
            filterAndRender();
            showToast("Backup imported successfully!", "success");
          }
        } catch (err) {
          showToast("Invalid JSON backup structure.", "danger");
        }
      };
      reader.readAsText(file);
    };
  }

  filterAndRender();
}

function renderHistoryList(list) {
  const emptyMsg = document.getElementById("historyEmpty");
  const listContainer = document.getElementById("historyList");

  if (!listContainer) return;
  listContainer.innerHTML = "";

  if (list.length === 0) {
    if (emptyMsg) emptyMsg.classList.remove("hidden");
    return;
  }

  if (emptyMsg) emptyMsg.classList.add("hidden");

  list.forEach(b => {
    const card = document.createElement("div");
    card.className = "glass p-5 rounded-2xl flex flex-col gap-3 animate-fadeIn";
    card.innerHTML = `
      <div class="flex justify-between items-start">
        <div>
          <h4 class="text-lg font-bold">${b.name}</h4>
          <p class="text-xs text-gray-400 font-mono">${b.packageName}</p>
        </div>
        <button class="fav-btn text-xl transition transform active:scale-95" data-id="${b.id}">
          ${b.favorite ? "⭐" : "☆"}
        </button>
      </div>
      <div class="flex gap-4 text-xs text-gray-400">
        <span>Version: ${b.version}</span>
        <span>Date: ${b.date}</span>
      </div>
      <div class="flex gap-2">
        <button class="history-dl-btn flex-1 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 py-2 rounded-lg text-sm font-semibold" data-id="${b.id}">
          Open Build
        </button>
        <button class="history-delete-btn bg-red-950/40 hover:bg-red-950/80 text-red-300 px-3 rounded-lg text-sm" data-id="${b.id}">
          🗑
        </button>
      </div>
    `;

    card.querySelector(".fav-btn").onclick = () => {
      triggerHaptic();
      b.favorite = !b.favorite;
      localStorage.setItem("wyte_builds", JSON.stringify(state.builds));
      initHistory();
    };

    card.querySelector(".history-dl-btn").onclick = async () => {
      triggerHaptic();
      if (!b.runId) {
        showToast("This build has no linked GitHub run to reopen.", "warning");
        return;
      }
      state.currentBuild = b;
      showScreen("processing");
      document.getElementById("stageList").innerHTML = "";
      document.getElementById("processingSubtitle").textContent = "Loading build info...";
      document.getElementById("processingFailed").classList.add("hidden");
      const token = localStorage.getItem("wyte_github_token");
      try {
        await completeBuild(token, state.user.login, b.runId);
      } catch (err) {
        showBuildFailure("Could not load this build — its artifacts may have expired on GitHub (they're kept for 90 days).");
      }
    };

    card.querySelector(".history-delete-btn").onclick = async () => {
      triggerHaptic();
      const confirmDel = await showConfirm("Delete?", `Are you sure you want to remove compilation record for ${b.name}?`);
      if (confirmDel) {
        state.builds = state.builds.filter(item => item.id !== b.id);
        localStorage.setItem("wyte_builds", JSON.stringify(state.builds));
        initHistory();
        showToast("Record deleted", "info");
      }
    };

    listContainer.appendChild(card);
  });
}

// --- UTILITIES & DIALOGS ---
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");

  const colors = {
    info: "border-indigo-500 text-indigo-200 bg-gray-900/95",
    success: "border-green-500 text-green-200 bg-gray-900/95",
    warning: "border-yellow-500 text-yellow-200 bg-gray-900/95",
    danger: "border-red-500 text-red-200 bg-gray-900/95"
  };

  toast.className = `p-4 rounded-xl text-sm border font-medium shadow-2xl flex items-center gap-3 backdrop-blur pointer-events-auto animate-toastIn ${colors[type] || colors.info}`;
  toast.innerHTML = `
    <span>${type === "success" ? "✔" : type === "warning" ? "⚠" : "ℹ"}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.className = toast.className.replace("animate-toastIn", "animate-toastOut");
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("dialogOverlay");
    const titleEl = document.getElementById("dialogTitle");
    const msgEl = document.getElementById("dialogMessage");
    const inputEl = document.getElementById("dialogInput");
    const cancelBtn = document.getElementById("dialogCancelBtn");
    const confirmBtn = document.getElementById("dialogConfirmBtn");

    if (!overlay) return resolve(false);

    titleEl.textContent = title;
    msgEl.textContent = message;
    inputEl.classList.add("hidden");
    overlay.classList.remove("hidden");

    const cleanup = () => {
      overlay.classList.add("hidden");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
    };

    const onConfirm = () => {
      cleanup();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
  });
}

function showAuthError(msg) {
  const errEl = document.getElementById("authError");
  if (errEl) {
    errEl.textContent = msg;
    errEl.classList.remove("hidden");
  }
}

function triggerHaptic() {
  if (state.settings.haptics && "vibrate" in navigator) {
    navigator.vibrate(12);
  }
}

// --- GLOBAL SCOPE EXPOSURE ---
window.login = login;
window.logout = logout;
window.triggerBuild = triggerBuild;
window.cancelBuild = cancelBuild;
window.retryBuild = retryBuild;
window.downloadApk = downloadApk;
window.copyRunLink = copyRunLink;
window.shareApk = shareApk;
window.deleteCurrentBuild = deleteCurrentBuild;
window.startNewBuild = startNewBuild;
