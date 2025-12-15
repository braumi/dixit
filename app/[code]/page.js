"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";

// Prevent static prerender issues with client-only hooks
export const dynamic = "force-dynamic";

const MAX_PLAYERS = 8;

export default function RoomPage({ params }) {
  const code = useMemo(() => (params?.code || "").toUpperCase(), [params?.code]);
  const router = useRouter();
  const [players, setPlayers] = useState([]);
  const [status, setStatus] = useState({ message: "", type: "" });
  const [clientId, setClientId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [shareUrl, setShareUrl] = useState("");

  useEffect(() => {
    // Set share URL (client-only to avoid hydration mismatch)
    setShareUrl(`${window.location.origin}/${code}`);

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
          updateStatus(body.error || "Failed to join room.", "error");
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
        .select("id")
        .eq("code", code)
        .single();
      
      if (error) console.error("Error fetching room:", error);
      return room?.id;
    };

    const refreshPlayers = async (roomId) => {
      const { data, error } = await supabase
        .from("room_players")
        .select("id, display_name, score, joined_at")
        .eq("room_id", roomId)
        .order("joined_at", { ascending: true });
      
      if (error) {
        console.error("Error fetching players:", error);
      } else if (data) {
        setPlayers(data);
      }
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
      }, 3000);

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

  const updateStatus = (message, type = "") => setStatus({ message, type });

  const handleStart = () => {
    if (players.length === 0) {
      updateStatus("Add at least one player to start.", "error");
      return;
    }
    updateStatus("Game started! (demo state)", "ok");
  };

  const remaining = MAX_PLAYERS - players.length;

  return (
    <div className="page">
      <header className="room-header">
        <div>
          <p className="pill">Private room</p>
          <h1>Room {code}</h1>
          <p className="sub">Share this link to invite friends:</p>
          <p className="share">{shareUrl}</p>
          <p className="muted">You are joining as: {displayName || "..."}</p>
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
            {players.map((player, idx) => (
              <div key={player.id} className="player-card">
                <div className="badge">{idx + 1}</div>
                <div className="player-name">{player.display_name}</div>
              </div>
            ))}
            {players.length === 0 && <p className="muted">{loading ? "Loading..." : "No players yet. Waiting for players to join."}</p>}
          </div>
        </div>

        <section className={`status ${status.type}`} role="status" aria-live="polite">
          {status.message}
        </section>

        <div className="start-row">
          <button type="button" className="primary-btn" onClick={handleStart}>
            Start Game
          </button>
        </div>
      </main>
    </div>
  );
}

