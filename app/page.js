"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Prevent static prerender issues with client-only hooks
export const dynamic = "force-dynamic";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const createFallbackCode = () => {
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
};

export default function HomePage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState({ message: "", type: "" });

  useEffect(() => {
    const stored = window.localStorage.getItem("dixit:name");
    if (stored) setUsername(stored);

    // Pre-fill join code if coming from a room link
    const search = new URLSearchParams(window.location.search);
    const codeParam = search.get("join");
    if (codeParam) {
      setJoinCode(codeParam.toUpperCase());
      setStatus({ message: "Enter your name to join this room", type: "ok" });
    }
  }, []);

  const updateStatus = (message, type = "") => setStatus({ message, type });

  const persistName = () => {
    if (!username.trim()) {
      updateStatus("Pick a username first.", "error");
      return false;
    }
    window.localStorage.setItem("dixit:name", username.trim());
    updateStatus("Saved locally. You'll use this name in lobbies.", "ok");
    return true;
  };

  const handleCreate = async () => {
    if (!persistName()) return;
    updateStatus("Creating room...", "");
    try {
      const res = await fetch("/api/rooms/create", { method: "POST" });
      if (!res.ok) throw new Error("Create failed");
      const { code } = await res.json();
      const url = `${window.location.origin}/${code}`;
      updateStatus(`Room ${code} ready. Share this link: ${url}`, "ok");
      router.push(`/${code}`);
    } catch (err) {
      const code = createFallbackCode();
      const url = `${window.location.origin}/${code}`;
      updateStatus(`Using local code ${code}. Share: ${url}`, "error");
      router.push(`/${code}`);
    }
  };

  const handleJoin = (event) => {
    event.preventDefault();
    if (!persistName()) return;
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      updateStatus("Enter a game code to join.", "error");
      return;
    }
    setJoinCode(code);
    updateStatus(`Attempting to join room ${code} as ${username.trim()}...`, "ok");
    router.push(`/${code}`);
  };

  return (
    <Suspense fallback={null}>
      <div className="page">
        <header className="hero">
          <div className="brand">
            <div className="logo">D</div>
            <div className="name">Dixit</div>
          </div>
          <div className="hero-copy">
            <p className="tagline">Tell stories. Guess creatively. Play together.</p>
            <p className="sub">Create a private room or jump into a friend's game in seconds.</p>
          </div>
        </header>

        <main className="card">
          <section className="user-block">
            <label htmlFor="username" className="label">
              Choose a username
            </label>
            <div className="input-row">
              <input
                id="username"
                name="username"
                type="text"
                placeholder="Storyteller123"
                maxLength={20}
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <button type="button" className="ghost-btn" onClick={persistName} title="Save name on this device">
                Save
              </button>
            </div>
            <p className="hint">We'll use this name inside your lobby.</p>
          </section>

          <section className="actions">
            <div className="action-card">
              <div>
                <h2>Create a private game</h2>
                <p>Spin up a room and share the code or link with friends.</p>
              </div>
              <button type="button" className="primary-btn" onClick={handleCreate}>
                Create Game
              </button>
            </div>

            <div className="divider">
              <span>or</span>
            </div>

            <form className="action-card" onSubmit={handleJoin}>
              <div className="join-fields">
                <div className="field">
                  <label htmlFor="join-code" className="label">
                    Game code
                  </label>
                  <input
                    id="join-code"
                    name="join-code"
                    type="text"
                    placeholder="ABCD"
                    maxLength={8}
                    autoComplete="off"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                  />
                </div>
              </div>
              <button type="submit" className="secondary-btn">
                Join Game
              </button>
            </form>
          </section>

          <section className={`status ${status.type}`} role="status" aria-live="polite">
            {status.message}
          </section>
        </main>

        <footer className="footer">
          <p>Inspired by the playful spirit of Dixit. This is a fan-made demo.</p>
        </footer>
      </div>
    </Suspense>
  );
}

