import { CONFIG, getGitHubUser, triggerGitHubAction } from './data.js';

const welcomeEl = document.getElementById("welcome");
const dashboardEl = document.getElementById("dashboard");

function login() {
  const url = `https://github.com/login/oauth/authorize?client_id=${CONFIG.CLIENT_ID}&scope=repo,workflow&redirect_uri=${CONFIG.REDIRECT_URI}`;
  window.location = url;
}

function saveToken() {
  const token = document.getElementById("tokenInput").value;
  if(!token.startsWith("ghp_") && !token.startsWith("github_pat_")) return alert("Invalid token format");
  localStorage.setItem("gh_token", token);
  alert("Token Saved! ✅");
  document.getElementById("tokenInput").value = "";
  loadDashboard();
}

async function handleAuth() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if(code) window.history.replaceState({}, document.title, "/");
  
  const token = localStorage.getItem("gh_token");
  if(token) await loadDashboard();
}

async function loadDashboard() {
  const token = localStorage.getItem("gh_token");
  if(!token) return;
  
  try {
    const user = await getGitHubUser(token);
    document.getElementById("username").innerText = user.login;
    document.getElementById("avatar").src = user.avatar_url;
    welcomeEl.classList.add("hidden");
    dashboardEl.classList.remove("hidden");
  } catch {
    alert("Invalid Token. Please add new one");
    localStorage.removeItem("gh_token");
  }
}

async function triggerBuild() {
  const url = document.getElementById("url").value;
  const appName = document.getElementById("appName").value;
  const token = localStorage.getItem("gh_token");
  
  if(!url || !appName) return alert("Fill App Name + URL");
  if(!token) return alert("Add your token in Settings first");
  
  const btn = document.getElementById("buildBtn");
  btn.innerText = "Building...";
  btn.disabled = true;
  
  const res = await triggerGitHubAction(url, appName, token);
  
  if(res.status === 204) alert(`Build Started! ✅\nGo to Actions tab in 2-3 mins to download APK`);
  else alert("Error: " + res.status + ". Check token has 'repo' and 'workflow' scope");
  
  btn.innerText = "Generate APK";
  btn.disabled = false;
}

window.login = login;
window.triggerBuild = triggerBuild;
window.saveToken = saveToken;

handleAuth();
