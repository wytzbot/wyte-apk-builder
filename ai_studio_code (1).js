/**
 * Wyte Builder - Main Application Core (app.js)
 * ES Module with global scope exposure for inline HTML event handlers.
 */

// --- CONFIGURATION ---
// Replace with your registered GitHub OAuth Application Client ID
const CLIENT_ID = "YOUR_GITHUB_CLIENT_ID"; 
const REDIRECT_URI = window.location.origin + window.location.pathname;

// --- STATE MANAGEMENT ---
let state = {
  user: null,
  builds: JSON.parse(localStorage.getItem("wyte_builds") || "[]"),
  currentBuild: null,
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

  // Update selection UI states
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
  // Animations toggle mapping
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

  // Haptics toggle mapping
  const hapticCheckbox = document.getElementById("settingHaptics");
  if (hapticCheckbox) {
    hapticCheckbox.checked = state.settings.haptics;
    hapticCheckbox.addEventListener("change", (e) => {
      state.settings.haptics = e.target.checked;
      saveSettings();
    });
  }

  // Data saver toggle mapping
  const dataSaverCheckbox = document.getElementById("settingDataSaver");
  if (dataSaverCheckbox) {
    dataSaverCheckbox.checked = state.settings.dataSaver;
    dataSaverCheckbox.addEventListener("change", (e) => {
      state.settings.dataSaver = e.target.checked;
      saveSettings();
    });
  }

  // Clear cache action
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
    // Strip temporary OAuth code from browser address bar
    window.history.replaceState({}, document.title, window.location.pathname);
    exchangeCodeForToken(code);
    return;
  }

  const token = localStorage.getItem("wyte_github_token");
  const localMockUser = localStorage.getItem("wyte_github_user");

  if (token) {
    if (token === "mock_token_123" && localMockUser) {
      state.user = JSON.parse(localMockUser);
      renderUserUI();
    } else {
      fetchUserInfo(token);
    }
  } else {
    showScreen("welcome");
  }
}

async function exchangeCodeForToken(code) {
  showToast("Exchanging OAuth code...", "info");
  
  // Real deployment demands a secure backend gateway to prevent client_secret leakage
  const gatewayUrl = "/api/github-token-exchange"; 
  
  try {
    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    const data = await response.json();
    if (data.access_token) {
      localStorage.setItem("wyte_github_token", data.access_token);
      fetchUserInfo(data.access_token);
    } else {
      showAuthError("Failed to obtain access token from gateway.");
    }
  } catch (error) {
    showAuthError("Could not reach OAuth Token Exchange gateway.");
  }
}

async function fetchUserInfo(token) {
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: { "Authorization": `token ${token}` }
    });
    if (response.ok) {
      state.user = await response.json();
      renderUserUI();
    } else {
      logout();
    }
  } catch (e) {
    showToast("GitHub server unreachable. Working offline.", "warning");
    showScreen("dashboard");
  }
}

function renderUserUI() {
  document.getElementById("username").textContent = state.user.name || state.user.login;
  document.getElementById("avatar").src = state.user.avatar_url;
  showScreen("dashboard");
}

function login() {
  triggerHaptic();
  
  // Simulation Fallback: If Client ID is unconfigured, auto-login client-side to keep app functional
  if (CLIENT_ID === "YOUR_GITHUB_CLIENT_ID") {
    showToast("Simulation Mode active", "info");
    const mockUser = {
      login: "developer-guest",
      name: "Guest Developer",
      avatar_url: "https://avatars.githubusercontent.com/u/9919?v=4"
    };
    localStorage.setItem("wyte_github_token", "mock_token_123");
    localStorage.setItem("wyte_github_user", JSON.stringify(mockUser));
    state.user = mockUser;
    renderUserUI();
    return;
  }

  // Real Production Flow Redirection
  window.location.href = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=repo,workflow`;
}

function logout() {
  triggerHaptic();
  localStorage.removeItem("wyte_github_token");
  localStorage.removeItem("wyte_github_user");
  state.user = null;
  showScreen("welcome");
  showToast("Logged out successfully", "info");
}

// --- SCREEN NAVIGATION ---
function initNavigation() {
  // Nav items click router
  document.querySelectorAll(".bottom-nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      triggerHaptic();
      showScreen(btn.dataset.nav);
    });
  });

  // Theme button toggles
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

// --- BUILD LOGIC ---
function triggerBuild() {
  triggerHaptic();
  
  const appName = document.getElementById("appName").value.trim();
  const url = document.getElementById("url").value.trim();
  const packageName = document.getElementById("packageName").value.trim();

  if (!appName || !url || !packageName) {
    showToast("Please fill in all required fields (*)", "warning");
    return;
  }

  // Set current build config state
  state.currentBuild = {
    id: Date.now(),
    name: appName,
    url: url,
    packageName: packageName,
    version: document.getElementById("versionName").value,
    size: "8.4 MB",
    duration: "2:48",
    date: new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
    favorite: false,
    note: ""
  };

  showScreen("processing");
  startSimulatedBuild();
}

function startSimulatedBuild() {
  const stages = [
    "Initializing GitHub actions container...",
    "Validating secure manifest configurations...",
    "Injecting standalone progressive assets...",
    "Executing Bubblewrap build script...",
    "Compiling system resources to target APK...",
    "Generating debug signing keys...",
    "Finalizing package and deployment links..."
  ];

  const stageList = document.getElementById("stageList");
  stageList.innerHTML = "";
  
  let currentStage = 0;
  let elapsedSeconds = 0;
  
  const progressSubtitle = document.getElementById("processingSubtitle");
  const elapsedEl = document.getElementById("elapsedTime");

  // Run timing interval loop
  state.buildInterval = setInterval(() => {
    elapsedSeconds++;
    const min = Math.floor(elapsedSeconds / 60);
    const sec = elapsedSeconds % 60;
    elapsedEl.textContent = `Elapsed: ${min}:${sec.toString().padStart(2, "0")}`;

    // Cycle build phase messages realistic pacing
    if (elapsedSeconds % 4 === 0 && currentStage < stages.length) {
      const li = document.createElement("li");
      li.className = "text-sm text-gray-300 animate-fadeIn flex items-center gap-2";
      li.innerHTML = `<span>✔</span> <span>${stages[currentStage]}</span>`;
      stageList.appendChild(li);
      progressSubtitle.textContent = stages[currentStage];
      currentStage++;
    }

    // Complete pipeline compilation criteria (approx 20s simulation)
    if (currentStage >= stages.length && elapsedSeconds >= 24) {
      clearInterval(state.buildInterval);
      completeBuild();
    }
  }, 1000);
}

function cancelBuild() {
  triggerHaptic();
  if (state.buildInterval) {
    clearInterval(state.buildInterval);
  }
  showScreen("dashboard");
  showToast("Build compilation canceled", "warning");
}

function retryBuild() {
  triggerBuild();
}

function completeBuild() {
  // Push build object to top of list
  state.builds.unshift(state.currentBuild);
  localStorage.setItem("wyte_builds", JSON.stringify(state.builds));

  // Populate download screen UI values
  document.getElementById("downloadAppName").textContent = state.currentBuild.name;
  document.getElementById("dlVersion").textContent = state.currentBuild.version;
  document.getElementById("dlPackage").textContent = state.currentBuild.packageName;
  document.getElementById("dlSize").textContent = state.currentBuild.size;
  document.getElementById("dlDuration").textContent = state.currentBuild.duration;
  document.getElementById("dlDate").textContent = state.currentBuild.date;

  // Generate real QR code redirect using window.QRCode (pointing back to standard run links)
  const qrContainer = document.getElementById("qrcode");
  qrContainer.innerHTML = "";
  
  if (window.QRCode) {
    new window.QRCode(qrContainer, {
      text: `https://github.com/actions/runs/${state.currentBuild.id}`,
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

function downloadApk() {
  triggerHaptic();
  showToast("Starting download transfer...", "success");
}

function copyRunLink() {
  triggerHaptic();
  if (state.currentBuild) {
    navigator.clipboard.writeText(`https://github.com/actions/runs/${state.currentBuild.id}`);
    showToast("GitHub Build Actions URL copied!", "success");
  }
}

function shareApk() {
  triggerHaptic();
  if (navigator.share && state.currentBuild) {
    navigator.share({
      title: state.currentBuild.name,
      text: `Install ${state.currentBuild.name} APK package compiled via Wyte.`,
      url: `https://github.com/actions/runs/${state.currentBuild.id}`
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

    // Sort evaluation
    const sortBy = sortSelect ? sortSelect.value : "newest";
    if (sortBy === "newest") {
      filtered.sort((a, b) => b.id - a.id);
    } else if (sortBy === "oldest") {
      filtered.sort((a, b) => a.id - b.id);
    } else if (sortBy === "name") {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "size") {
      filtered.sort((a, b) => parseFloat(b.size) - parseFloat(a.size));
    }

    renderHistoryList(filtered);
  };

  if (searchInput) searchInput.addEventListener("input", filterAndRender);
  if (sortSelect) sortSelect.addEventListener("change", filterAndRender);
  if (favoritesCheckbox) favoritesCheckbox.addEventListener("change", filterAndRender);

  // Bind Export/Import
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
        <span>Size: ${b.size}</span>
        <span>Date: ${b.date}</span>
      </div>
      <div class="flex gap-2">
        <button class="history-dl-btn flex-1 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 py-2 rounded-lg text-sm font-semibold" data-id="${b.id}">
          Launch Download
        </button>
        <button class="history-delete-btn bg-red-950/40 hover:bg-red-950/80 text-red-300 px-3 rounded-lg text-sm" data-id="${b.id}">
          🗑
        </button>
      </div>
    `;

    // Dynamic state delegation
    card.querySelector(".fav-btn").onclick = (e) => {
      triggerHaptic();
      b.favorite = !b.favorite;
      localStorage.setItem("wyte_builds", JSON.stringify(state.builds));
      initHistory();
    };

    card.querySelector(".history-dl-btn").onclick = () => {
      triggerHaptic();
      state.currentBuild = b;
      completeBuild();
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
  
  // Dynamic design presets mapping toast parameters
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
// Required to support the existing index.html inline event handler mappings
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