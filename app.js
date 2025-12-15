const usernameInput = document.querySelector("#username");
const rememberBtn = document.querySelector("#remember");
const createBtn = document.querySelector("#create-btn");
const joinForm = document.querySelector("#join-form");
const joinCodeInput = document.querySelector("#join-code");
const statusEl = document.querySelector("#status");

const setStatus = (msg, type = "") => {
  statusEl.textContent = msg;
  statusEl.classList.remove("ok", "error");
  if (type) statusEl.classList.add(type);
};

const getUsername = () => usernameInput.value.trim();

const saveUsername = () => {
  const name = getUsername();
  if (!name) {
    setStatus("Pick a username first.", "error");
    return;
  }
  localStorage.setItem("dixit:name", name);
  setStatus("Saved locally. You'll use this name in lobbies.", "ok");
};

const loadUsername = () => {
  const stored = localStorage.getItem("dixit:name");
  if (stored) usernameInput.value = stored;
};

const generateGameCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
};

const createGame = () => {
  const name = getUsername();
  if (!name) {
    setStatus("Enter a username before creating a game.", "error");
    return;
  }
  saveUsername();
  const code = generateGameCode();
  const link = `${window.location.origin}/room/${code}`;
  setStatus(`Room ${code} ready. Share this link: ${link}`, "ok");
};

const joinGame = (evt) => {
  evt.preventDefault();
  const name = getUsername();
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!name) {
    setStatus("Enter a username before joining.", "error");
    return;
  }
  if (!code) {
    setStatus("Enter a game code to join.", "error");
    return;
  }
  saveUsername();
  joinCodeInput.value = code;
  setStatus(`Attempting to join room ${code} as ${name}...`, "ok");
};

rememberBtn.addEventListener("click", saveUsername);
createBtn.addEventListener("click", createGame);
joinForm.addEventListener("submit", joinGame);
loadUsername();

