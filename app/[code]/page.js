"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

// Prevent static prerender issues with client-only hooks
export const dynamic = "force-dynamic";

const MAX_PLAYERS = 8;

// Generate initials from username (first letter of each word)
const getInitials = (name) => {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase())
    .join("")
    .slice(0, 2); // Max 2 letters
};

// Generate a consistent color based on username
const getAvatarColor = (name) => {
  if (!name) return "#6b7280";
  
  // Generate a hash from the name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Generate a color from the hash (bright, saturated colors)
  const hue = Math.abs(hash) % 360;
  const saturation = 65 + (Math.abs(hash) % 20); // 65-85%
  const lightness = 50 + (Math.abs(hash) % 15); // 50-65%
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

export default function RoomPage({ params }) {
  const code = useMemo(() => (params?.code || "").toUpperCase(), [params?.code]);
  const router = useRouter();
  const [players, setPlayers] = useState([]);
  const [status, setStatus] = useState({ message: "", type: "" });
  const [clientId, setClientId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [roomSettings, setRoomSettings] = useState({ roundsPerPlayer: 5, cardSet: "original", phase: "lobby" });

  useEffect(() => {
    // Set share URL (client-only to avoid hydration mismatch)
    setShareUrl(`https://dixiqit.netlify.app/${code}`);

    // Check if user has set their name
    const savedName = window.localStorage.getItem("dixit:name");
    if (!savedName || !savedName.trim()) {
      // Redirect to home page to set name, with join code pre-filled
      router.push(`/?join=${code}`);
      return;
    }

    // User has a name, proceed with joining
    const ensureClientId = () => {
      const key = "dixit:client-id";
      let existing = window.localStorage.getItem(key);
      if (!existing) {
        existing = crypto.randomUUID();
        window.localStorage.setItem(key, existing);
      }
      return existing;
    };
    setClientId(ensureClientId());
    setDisplayName(savedName.trim());
  }, [code, router]);

  useEffect(() => {
    const join = async () => {
      if (!code || !clientId || !displayName) return;
      setLoading(true);
      try {
        const res = await fetch("/api/rooms/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, displayName, clientId }),
        });
        const body = await res.json();
        if (!res.ok) {
          if (body.error === "Game has already started") {
            // Redirect back home with pre-filled code and error flag
            router.push(`/?join=${code}&error=started`);
          } else {
            updateStatus(body.error || "Failed to join room.", "error");
          }
          setLoading(false);
          return;
        }
        setPlayers(body.players || []);
        updateStatus(`Joined as ${displayName}`, "ok");
      } catch (err) {
        updateStatus("Failed to join room.", "error");
      } finally {
        setLoading(false);
      }
    };
    join();
  }, [code, clientId, displayName]);

  // Set up realtime subscription for player updates
  useEffect(() => {
    if (!supabase || !code) {
      console.log("Realtime setup skipped: supabase or code missing");
      return;
    }

    let channel = null;
    let pollInterval = null;

    const fetchRoom = async () => {
      const { data: room, error } = await supabase
        .from("rooms")
        .select("id, card_set, rounds_per_player, phase")
        .eq("code", code)
        .single();
      
      if (error) console.error("Error fetching room:", error);
      if (room) {
        setRoomSettings({
          roundsPerPlayer: room.rounds_per_player ?? 5,
          cardSet: room.card_set ?? "original",
          phase: room.phase ?? "lobby",
        });
      }
      return room?.id;
    };

    const refreshPlayers = async (roomId) => {
      const { data, error } = await supabase
        .from("room_players")
        .select("id, display_name, client_id, score, joined_at, is_host")
        .eq("room_id", roomId)
        .order("joined_at", { ascending: true });
      
      if (error) {
        console.error("Error fetching players:", error);
      } else if (data) {
        setPlayers(data);
      }
    };

    const refreshRoomSettings = async (roomId) => {
      const { data, error } = await supabase
        .from("rooms")
        .select("card_set, rounds_per_player, phase")
        .eq("id", roomId)
        .single();

      if (error) {
        console.error("Error fetching room settings:", error);
        return;
      }
      setRoomSettings({
        roundsPerPlayer: data.rounds_per_player ?? 5,
        cardSet: data.card_set ?? "original",
        phase: data.phase ?? "lobby",
      });
    };

    const setupRealtimeSubscription = async () => {
      const roomId = await fetchRoom();
      if (!roomId) {
        console.log("No room found for code:", code);
        return;
      }

      console.log("Setting up realtime for room:", roomId);

      // Set up polling as fallback (every 3 seconds)
      pollInterval = setInterval(() => {
        console.log("Polling for player updates...");
        refreshPlayers(roomId);
        refreshRoomSettings(roomId);
      }, 3000);

      // Initial refresh (so non-host sees settings immediately)
      refreshPlayers(roomId);
      refreshRoomSettings(roomId);

      // Try to set up realtime subscription
      channel = supabase
        .channel(`room-${code}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "room_players",
            filter: `room_id=eq.${roomId}`,
          },
          async (payload) => {
            console.log("Realtime update received:", payload);
            await refreshPlayers(roomId);
          }
        )
        .subscribe((status) => {
          console.log("Realtime subscription status:", status);
        });
    };

    setupRealtimeSubscription();

    return () => {
      if (channel) {
        console.log("Cleaning up realtime channel");
        supabase.removeChannel(channel);
      }
      if (pollInterval) {
        console.log("Clearing poll interval");
        clearInterval(pollInterval);
      }
    };
  }, [code]);

  // If host starts the game, everyone should move to the game screen
  useEffect(() => {
    if (roomSettings.phase && roomSettings.phase !== "lobby") {
      router.push(`/${code}/game`);
    }
  }, [roomSettings.phase, router, code]);

  const updateStatus = (message, type = "") => setStatus({ message, type });

  const meIsHost = useMemo(() => {
    const me = players.find((p) => p.client_id === clientId);
    return Boolean(me?.is_host);
  }, [players, clientId]);

  const setRoundsPerPlayer = async (value) => {
    setRoomSettings((s) => ({ ...s, roundsPerPlayer: value }));
    if (!meIsHost) return;
    try {
      const res = await fetch("/api/rooms/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, clientId, roundsPerPlayer: value }),
      });
      const body = await res.json();
      if (!res.ok) {
        updateStatus(body.error || "Failed to update settings.", "error");
        return;
      }
      updateStatus("Settings updated.", "ok");
    } catch {
      updateStatus("Failed to update settings.", "error");
    }
  };

  const setCardSet = async (value) => {
    setRoomSettings((s) => ({ ...s, cardSet: value }));
    if (!meIsHost) return;
    try {
      const res = await fetch("/api/rooms/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, clientId, cardSet: value }),
      });
      const body = await res.json();
      if (!res.ok) {
        updateStatus(body.error || "Failed to update settings.", "error");
        return;
      }
      updateStatus("Settings updated.", "ok");
    } catch {
      updateStatus("Failed to update settings.", "error");
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      updateStatus("Failed to copy link.", "error");
    }
  };

  const handleStart = () => {
    if (players.length === 0) {
      updateStatus("Add at least one player to start.", "error");
      return;
    }
    const start = async () => {
      try {
        const res = await fetch("/api/game/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, clientId }),
        });
        const body = await res.json();
        if (!res.ok) {
          updateStatus(body.error || "Failed to start game.", "error");
          return;
        }
        updateStatus("Game started.", "ok");
        router.push(`/${code}/game`);
      } catch {
        updateStatus("Failed to start game.", "error");
      }
    };
    start();
  };

  const remaining = MAX_PLAYERS - players.length;

  return (
    <div className="page">
      <header className="room-header">
        <div>
          <p className="pill">Private room</p>
          <h1>Room {code}</h1>
          <p className="sub">Share this link to invite friends:</p>
          <div className="share-container" style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
            <p className="share" style={{ margin: 0, flex: 1 }}>{shareUrl}</p>
            <button
              type="button"
              onClick={handleCopyLink}
              className="copy-btn"
              title={copied ? "Copied!" : "Copy link"}
              style={{
                background: copied ? "var(--accent)" : "rgba(255, 255, 255, 0.1)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                padding: "8px 12px",
                color: copied ? "#0c0c0c" : "var(--text)",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 600,
                transition: "all 0.2s ease",
                whiteSpace: "nowrap",
              }}
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>
        </div>
        <Link className="ghost-btn" href="/">
          ⟵ Back home
        </Link>
      </header>

      <main className="card">
        <div className="players">
          <div className="players-header">
            <h2>Players ({players.length}/{MAX_PLAYERS})</h2>
            <p className="muted">{remaining} spots left</p>
          </div>
          <div className="player-grid">
            {players.map((player, idx) => {
              const initials = getInitials(player.display_name);
              const avatarColor = getAvatarColor(player.display_name);
              const isCurrentPlayer = player.client_id === clientId;
              return (
                <div 
                  key={player.id} 
                  className="player-card"
                  style={{
                    border: isCurrentPlayer ? `2px solid ${avatarColor}` : "none",
                    borderRadius: "12px",
                    padding: isCurrentPlayer ? "10px" : "0",
                  }}
                >
                  <div
                    className="player-avatar"
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "50%",
                      backgroundColor: avatarColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontSize: "18px",
                      fontWeight: 600,
                      flexShrink: 0,
                      border: "2px solid rgba(255, 255, 255, 0.2)",
                    }}
                  >
                    {initials}
                  </div>
                  <div className="player-name">
                    {player.display_name}
                    {player.is_host ? (
                      <span className="crown" title="Room host">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M5 19h14l-1.5-9-4 3-3-6-3 6-4-3z" />
                        </svg>
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {players.length === 0 && <p className="muted">{loading ? "Loading..." : "No players yet. Waiting for players to join."}</p>}
          </div>
        </div>

        <section className={`status ${status.type}`} role="status" aria-live="polite">
          {status.message}
        </section>

        <div className="start-row">
          <div className="settings">
            <div className="settings-group">
              <span className="settings-label">Rounds per player</span>
              <select
                className="select"
                value={roomSettings.roundsPerPlayer}
                onChange={(e) => setRoundsPerPlayer(Number(e.target.value))}
                disabled={!meIsHost}
              >
                {Array.from({ length: 10 }).map((_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-group">
              <span className="settings-label">Cards</span>
              <div className="toggle">
                <button
                  type="button"
                  className={`toggle-btn ${roomSettings.cardSet === "original" ? "active" : ""}`}
                  onClick={() => setCardSet("original")}
                  disabled={!meIsHost}
                >
                  Original
                </button>
                <button
                  type="button"
                  className={`toggle-btn ${roomSettings.cardSet === "custom" ? "active" : ""}`}
                  onClick={() => setCardSet("custom")}
                  disabled={!meIsHost}
                >
                  Custom
                </button>
              </div>
            </div>
          </div>

          <button type="button" className="primary-btn" onClick={handleStart} disabled={!meIsHost}>
            Start Game
          </button>
        </div>
      </main>
    </div>
  );
}

