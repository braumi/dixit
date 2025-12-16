"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

export const dynamic = "force-dynamic";

const bucket = "cards";

const cardUrl = (path) => {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return "";
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
};

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

export default function GamePage({ params }) {
  const code = useMemo(() => (params?.code || "").toUpperCase(), [params?.code]);
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [me, setMe] = useState(null);
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [status, setStatus] = useState("");
  const [selectedCard, setSelectedCard] = useState(null);
  const [storyPrompt, setStoryPrompt] = useState("");
  const [submissions, setSubmissions] = useState([]);
  const [selectedVote, setSelectedVote] = useState(null);
  const [showStoryModal, setShowStoryModal] = useState(false);
  const [previousRound, setPreviousRound] = useState(null);
  const previousPhaseRef = useRef(null);
  const modalTimerRef = useRef(null);

  useEffect(() => {
    const key = "dixit:client-id";
    const stored = window.localStorage.getItem(key);
    if (!stored) {
      setStatus("Missing client id. Go back home and join again.");
      return;
    }
    setClientId(stored);

    const savedName = window.localStorage.getItem("dixit:name");
    if (!savedName || !savedName.trim()) {
      router.push(`/?join=${code}`);
    }
  }, [code, router]);

  useEffect(() => {
    if (!supabase || !code || !clientId) return;

    let channel = null;
    let poll = null;

    const refresh = async () => {
      const { data: roomRow } = await supabase
        .from("rooms")
        .select("id, phase, story_text, storyteller_id, current_round, total_rounds, rounds_per_player, card_set")
        .eq("code", code)
        .maybeSingle();

      if (!roomRow) return;
      setRoom(roomRow);

      const { data: roster } = await supabase
        .from("room_players")
        .select("id, display_name, client_id, score, is_host, hand")
        .eq("room_id", roomRow.id)
        .order("joined_at", { ascending: true });
      setPlayers(roster || []);

      const mine = (roster || []).find((p) => p.client_id === clientId) || null;
      setMe(mine);

      // Fetch submissions if in voting or reveal phase
      if ((roomRow.phase === "voting" || roomRow.phase === "reveal") && roomRow.current_round) {
        const { data: subs } = await supabase
          .from("submissions")
          .select("id, card_path, player_id, is_storyteller_card, vote_for_player")
          .eq("room_id", roomRow.id)
          .eq("round_number", roomRow.current_round)
          .order("created_at", { ascending: true }); // Consistent order, no shuffle

        if (subs) {
          // Join with player names
          const subsWithNames = subs.map((sub) => {
            const player = (roster || []).find((p) => p.id === sub.player_id);
            return {
              ...sub,
              player_name: player?.display_name || "Unknown",
            };
          });
          setSubmissions(subsWithNames);
        }
      } else {
        setSubmissions([]);
      }
    };

    const setup = async () => {
      await refresh();
      poll = setInterval(refresh, 2000);

      // best-effort realtime (requires Realtime enabled)
      channel = supabase
        .channel(`game-${code}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "rooms" },
          () => refresh()
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "room_players" },
          () => refresh()
        )
        .subscribe();
    };

    setup();

    return () => {
      if (poll) clearInterval(poll);
      if (channel) supabase.removeChannel(channel);
    };
  }, [code, clientId]);

  const storyteller = useMemo(() => {
    if (!room?.storyteller_id) return null;
    return players.find((p) => p.id === room.storyteller_id) || null;
  }, [players, room?.storyteller_id]);

  const isStoryteller = Boolean(me?.id && room?.storyteller_id && me.id === room.storyteller_id);
  const hand = Array.isArray(me?.hand) ? me.hand : [];

  // Show modal once when storyteller submits (phase storyteller_pick -> submit) for non-storytellers (3s)
  useEffect(() => {
    if (!room || !me) return;
    const currentPhase = room.phase;
    const previousPhase = previousPhaseRef.current;
    const isCurrentStoryteller = Boolean(me.id && room.storyteller_id && me.id === room.storyteller_id);

    const transitionedToSubmit =
      previousPhase === "storyteller_pick" &&
      currentPhase === "submit" &&
      room.story_text;

    if (transitionedToSubmit && !isCurrentStoryteller) {
      setShowStoryModal(true);
      // Update ref after showing modal
      previousPhaseRef.current = currentPhase;
    } else {
      // Update ref when phase changes
      if (currentPhase !== previousPhase) {
        previousPhaseRef.current = currentPhase || null;
      }
    }
  }, [room?.phase, room?.story_text, room?.storyteller_id, me]);

  // Separate effect to handle modal auto-close timer - only depends on showStoryModal
  useEffect(() => {
    if (showStoryModal) {
      // Clear any existing timer
      if (modalTimerRef.current) {
        clearTimeout(modalTimerRef.current);
      }
      
      // Set timer to close modal after 3 seconds
      modalTimerRef.current = setTimeout(() => {
        setShowStoryModal(false);
        modalTimerRef.current = null;
      }, 3000);
      
      return () => {
        if (modalTimerRef.current) {
          clearTimeout(modalTimerRef.current);
          modalTimerRef.current = null;
        }
      };
    }
  }, [showStoryModal]);

  const canSelectCard = useMemo(() => {
    if (!room) return false;
    if (isStoryteller && room.phase === "storyteller_pick") return true;
    if (!isStoryteller && room.phase === "submit") return true;
    return false;
  }, [room, isStoryteller]);

  // Debug log
  useEffect(() => {
    if (room && me) {
      console.log("Game state:", {
        phase: room.phase,
        isStoryteller,
        canSelectCard,
        meId: me.id,
        storytellerId: room.storyteller_id,
      });
    }
  }, [room, me, isStoryteller, canSelectCard]);

  const handleCardClick = (path) => {
    if (!canSelectCard) {
      console.log("Card click blocked - canSelectCard:", canSelectCard, "phase:", room?.phase, "isStoryteller:", isStoryteller);
      return;
    }
    if (selectedCard === path) {
      setSelectedCard(null);
    } else {
      setSelectedCard(path);
    }
  };

  const handleVote = async () => {
    if (!selectedVote || isStoryteller) return;

    const submission = submissions.find((s) => s.id === selectedVote);
    if (!submission) return;

    // Cannot vote for own card
    if (me && submission.player_id === me.id) {
      setStatus("You cannot vote for your own card");
      return;
    }

    setStatus("Submitting vote...");
    try {
      const res = await fetch("/api/game/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          clientId,
            votedForPlayerId: submission.player_id,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "Failed to submit vote");
        return;
      }

      setSelectedVote(null);
      setStatus("");
    } catch (err) {
      setStatus("Failed to submit vote");
    }
  };

  const handleConfirm = async () => {
    if (!selectedCard) return;

    if (isStoryteller) {
      if (!storyPrompt.trim()) {
        setStatus("Please write a prompt before confirming.");
        return;
      }
      
      setStatus("Submitting prompt...");
      try {
        const res = await fetch("/api/game/submit-storyteller", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            clientId,
            cardPath: selectedCard,
            prompt: storyPrompt.trim(),
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setStatus(data.error || "Failed to submit prompt");
          return;
        }

        // Success - close overlay and clear selection
        setSelectedCard(null);
        setStoryPrompt("");
        setStatus("");
      } catch (err) {
        setStatus("Failed to submit prompt");
      }
    } else {
      // Non-storyteller submitting their card
      setStatus("Submitting card...");
      try {
        const res = await fetch("/api/game/submit-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            clientId,
            cardPath: selectedCard,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setStatus(data.error || "Failed to submit card");
          return;
        }

        // Success - close overlay and clear selection
        setSelectedCard(null);
        setStatus("");
      } catch (err) {
        setStatus("Failed to submit card");
      }
    }
  };

  const handleNextRound = async () => {
    if (!room || room.phase !== "reveal" || !isStoryteller) return;
    setStatus("Starting next round...");
    try {
      const res = await fetch("/api/game/next-round", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, clientId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "Failed to start next round");
        return;
      }
      setSelectedVote(null);
      setSelectedCard(null);
      setStoryPrompt("");
      setStatus("");
    } catch (err) {
      setStatus("Failed to start next round");
    }
  };

  const handleRestart = async (resetCards = false) => {
    if (!room || !isGameFinished || !clientId) {
      setStatus("Cannot return to lobby at this time");
      return;
    }
    setStatus("Returning to lobby...");
    try {
      const res = await fetch("/api/game/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, clientId, resetCards }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error || "Failed to return to lobby");
        return;
      }
      setStatus("");
      // Redirect to lobby page
      router.push(`/${code}`);
    } catch (err) {
      console.error("Restart error:", err);
      setStatus("Failed to return to lobby: " + (err.message || "Unknown error"));
    }
  };

  // Check if game is finished
  const isGameFinished = room?.phase === "finished" || (room?.current_round && room?.total_rounds && room.current_round > room.total_rounds);
  
  // Sort players by score for leaderboard
  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
  }, [players]);


  // Calculate points received this round for a player
  const getRoundPoints = useMemo(() => {
    if (!room || !submissions.length || room.phase !== "reveal") return () => 0;
    
    const nonStorytellerPlayers = players.filter((p) => p.id !== room.storyteller_id);
    const nonStorytellerCount = nonStorytellerPlayers.length;
    
    // Count votes for storyteller's card
    const votesForStoryteller = submissions.filter(
      (sub) => sub.vote_for_player === room.storyteller_id && sub.player_id !== room.storyteller_id
    ).length;
    
    // Count votes per player (excluding storyteller; guard against self votes)
    const votesPerPlayer = {};
    submissions.forEach((sub) => {
      if (
        sub.vote_for_player &&
        sub.vote_for_player !== room.storyteller_id &&
        sub.player_id !== sub.vote_for_player
      ) {
        votesPerPlayer[sub.vote_for_player] = (votesPerPlayer[sub.vote_for_player] || 0) + 1;
      }
    });
    
    // Calculate base points
    const basePoints = {};
    
    if (votesForStoryteller === 0 || votesForStoryteller === nonStorytellerCount) {
      // Case 1: No one or everyone voted for storyteller
      basePoints[room.storyteller_id] = 0;
      nonStorytellerPlayers.forEach((p) => {
        basePoints[p.id] = 2;
      });
    } else {
      // Case 2: Some voted for storyteller
      basePoints[room.storyteller_id] = 3;
      submissions.forEach((sub) => {
        if (sub.player_id === room.storyteller_id) return;
        if (sub.vote_for_player === room.storyteller_id) {
          basePoints[sub.player_id] = 3;
        } else {
          basePoints[sub.player_id] = basePoints[sub.player_id] || 0;
        }
      });
    }
    
    // Return function that calculates total points (base + votes received)
    return (playerId) => {
      const base = basePoints[playerId] || 0;
      const votesReceived = votesPerPlayer[playerId] || 0;
      return base + votesReceived;
    };
  }, [room, submissions, players]);

  // Get voters for a specific card (by player_id)
  const getVotersForCard = useMemo(() => {
    if (!submissions.length) return () => [];
    
    return (cardPlayerId) => {
      return submissions
        .filter((sub) => sub.vote_for_player === cardPlayerId && sub.player_id !== cardPlayerId)
        .map((sub) => {
          const voter = players.find((p) => p.id === sub.player_id);
          return voter ? { id: voter.id, name: voter.display_name } : null;
        })
        .filter(Boolean);
    };
  }, [submissions, players]);

  // Helper function to get player status text for leaderboard
  const getPlayerStatus = (playerId) => {
    if (!room) return null;
    
    const isStoryteller = room.storyteller_id === playerId;
    
    // Storyteller status
    if (isStoryteller) {
      if (room.phase === "storyteller_pick") {
        return "Choosing...";
      }
      return "Storyteller";
    }
    
    // Non-storyteller statuses
    if (room.phase === "submit") {
      const submitted = submissions.some((sub) => sub.player_id === playerId && sub.card_path);
      return submitted ? "Confirmed" : "Choosing...";
    }
    
    if (room.phase === "voting") {
      const voted = submissions.some((sub) => sub.player_id === playerId && sub.vote_for_player != null);
      return voted ? "Voted" : "Voting";
    }
    
    if (room.phase === "reveal") {
      const voted = submissions.some((sub) => sub.player_id === playerId && sub.vote_for_player != null);
      return voted ? "Voted" : null;
    }
    
    return null;
  };

  // Game finished screen
  if (isGameFinished) {
    return (
      <div className="page">
        <div className="game-end-screen">
          <div className="game-end-content">
            <h1 style={{ fontSize: "48px", marginBottom: "16px", textAlign: "center" }}>Game Finished!</h1>
            <h2 style={{ fontSize: "24px", marginBottom: "32px", textAlign: "center", color: "var(--muted)" }}>
              Final Leaderboard
            </h2>
            
            <div className="final-leaderboard">
              {sortedPlayers.map((player, index) => {
                const rank = index + 1;
                const initials = getInitials(player.display_name);
                const avatarColor = getAvatarColor(player.display_name);
                const isTopThree = rank <= 3;
                const isCurrentPlayer = player.client_id === clientId;
                
                return (
                  <div
                    key={player.id}
                    className={`final-leader-row ${isTopThree ? `rank-${rank}` : ""}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "16px",
                      padding: "16px 20px",
                      background: isTopThree ? "rgba(244, 162, 97, 0.1)" : "rgba(255, 255, 255, 0.02)",
                      border: isCurrentPlayer ? `2px solid ${avatarColor}` : (isTopThree ? `2px solid var(--accent)` : "1px solid var(--border)"),
                      borderRadius: "12px",
                      marginBottom: "12px",
                    }}
                  >
                    <div
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
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "20px", fontWeight: 600 }}>
                          {player.display_name}
                        </span>
                        {player.is_host && <span style={{ color: "#f9c74f" }}>★</span>}
                      </div>
                    </div>
                    {isTopThree && (
                      <div
                        style={{
                          fontSize: "32px",
                          fontWeight: 700,
                          color: "var(--accent)",
                          minWidth: "60px",
                          textAlign: "right",
                        }}
                      >
                        {rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉"}
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: "24px",
                        fontWeight: 700,
                        color: isTopThree ? "var(--accent)" : "var(--text)",
                        minWidth: "80px",
                        textAlign: "right",
                      }}
                    >
                      {player.score ?? 0} pts
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: "40px", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
              {status && (
                <div className={`status ${status.includes("error") || status.includes("Failed") ? "error" : ""}`} role="status" aria-live="polite">
                  {status}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "center", gap: "16px", flexWrap: "wrap" }}>
                <Link className="secondary-btn" href={`/${code}`} style={{ padding: "12px 24px" }}>
                  Back to Lobby
                </Link>
                {(me?.is_host || (room && me && room.owner_player_id === me.id)) && (
                  <button type="button" className="primary-btn" onClick={() => handleRestart(false)} style={{ padding: "12px 24px" }}>
                    Return to Lobby
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {showStoryModal && (
        <div className="story-submitted-modal">
          <div className="story-submitted-content">
            <h2>Story Submitted</h2>
            {room?.story_text && (
              <p style={{ fontSize: "20px", fontWeight: 600, color: "var(--accent)", marginBottom: "12px" }}>
                “{room.story_text}”
              </p>
            )}
            <p>Pick a card that matches the story.</p>
          </div>
        </div>
      )}
      <header className="room-header">
        <div>
          <p className="pill">Game</p>
          <h1>Room {code}</h1>
          <p className="muted">
            Round {room?.current_round ?? "-"} / {room?.total_rounds ?? "-"} • Deck: {room?.card_set ?? "-"}
          </p>
        </div>
        <Link className="ghost-btn" href={`/${code}`}>
          ⟵ Back to lobby
        </Link>
      </header>

      <main className="card">
        <div className="game-layout">
          <div className="game-main">
            <div className="players-header">
              <h2>Story</h2>
              <p className="muted">Phase: {room?.phase ?? "—"}</p>
            </div>

            <div className="share" style={{ marginTop: 10 }}>
              {room?.story_text
                ? room.story_text
                : isStoryteller
                ? "Pick a card and write a prompt."
                : room?.phase === "submit"
                ? "Choose a card that matches the prompt."
                : "Waiting for story..."}
            </div>

            {(room?.phase === "voting" || room?.phase === "reveal") && submissions.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div className="players-header">
                  <h2>{room?.phase === "voting" ? "Vote for the storyteller's card" : "Results"}</h2>
                  {room?.phase === "reveal" && isStoryteller ? (
                    room.current_round < room.total_rounds ? (
                      <button type="button" className="primary-btn" onClick={handleNextRound}>
                        Next Round
                      </button>
                    ) : (
                      <button type="button" className="primary-btn" onClick={handleNextRound}>
                        Finish
                      </button>
                    )
                  ) : (
                    <p className="muted">{submissions.length} cards</p>
                  )}
                </div>
                <div className="card-grid" style={{ marginTop: 16 }}>
                  {submissions.map((sub) => {
                    const cardPlayer = players.find((p) => p.id === sub.player_id);
                    const roundPoints = room?.phase === "reveal" ? getRoundPoints(sub.player_id) : 0;
                    const voters = room?.phase === "reveal" ? getVotersForCard(sub.player_id) : [];
                    const isOwnCard = me && sub.player_id === me.id;
                    
                    return (
                      <div
                        key={sub.id}
                        className="submission-card-wrapper"
                        style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}
                      >
                        {room?.phase === "reveal" && (
                          <div
                            className="submission-player-name"
                            style={{
                              marginBottom: 8,
                              fontWeight: 600,
                              color: sub.is_storyteller_card ? "var(--accent)" : "var(--text)",
                              fontSize: "14px",
                              textAlign: "center",
                            }}
                          >
                            {cardPlayer?.display_name || sub.player_name || "—"}
                            {sub.is_storyteller_card && " (Storyteller)"}
                            {roundPoints !== undefined && roundPoints > 0 && ` (+${roundPoints})`}
                          </div>
                        )}
                        <div
                          className={`card-tile ${room?.phase === "voting" && selectedVote === sub.id ? "selected" : ""}`}
                          onClick={() => {
                            if (room?.phase !== "voting") return;
                            if (isStoryteller) return; // Storyteller can't vote
                            setSelectedVote(sub.id);
                          }}
                          style={{
                            cursor: room?.phase === "voting" && !isStoryteller ? "pointer" : "default",
                            opacity: room?.phase === "voting" && isStoryteller ? 0.5 : 1,
                            width: "100%",
                            position: "relative",
                          }}
                        >
                          {room?.phase === "reveal" && voters.length > 0 && (
                            <div
                              style={{
                                position: "absolute",
                                top: 8,
                                left: "50%",
                                transform: "translateX(-50%)",
                                display: "flex",
                                gap: 4,
                                zIndex: 10,
                                flexWrap: "wrap",
                                justifyContent: "center",
                                maxWidth: "calc(100% - 16px)",
                                pointerEvents: "none",
                              }}
                            >
                              {voters.map((voter) => {
                                const initials = getInitials(voter.name);
                                const avatarColor = getAvatarColor(voter.name);
                                return (
                                  <div
                                    key={voter.id}
                                    style={{
                                      width: 28,
                                      height: 28,
                                      borderRadius: "50%",
                                      backgroundColor: avatarColor,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      color: "#fff",
                                      fontSize: "11px",
                                      fontWeight: 600,
                                      border: "2px solid rgba(255, 255, 255, 0.4)",
                                      boxShadow: "0 2px 6px rgba(0, 0, 0, 0.4)",
                                    }}
                                    title={voter.name}
                                  >
                                    {initials}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <img className="card-img" src={cardUrl(sub.card_path)} alt="Submitted card" />
                        </div>
                      </div>
                    );
                  })}
                </div>
                {room?.phase === "voting" && isStoryteller && (
                  <div className="start-row" style={{ marginTop: 20 }}>
                    <div className="muted">You are the storyteller. Wait for others to vote.</div>
                  </div>
                )}
              </div>
            )}

        {(selectedCard || (room?.phase === "voting" && selectedVote)) && (
          <div
            className="selected-card-overlay"
            onClick={(e) => {
              if (e.target.className === "selected-card-overlay") {
                setSelectedCard(null);
                setStoryPrompt("");
                setSelectedVote(null);
              }
            }}
          >
            <div className="selected-card-content" onClick={(e) => e.stopPropagation()}>
              <div className="selected-card-preview">
                {room?.phase === "voting" && selectedVote ? (
                  <img
                    className="card-img-large"
                    src={cardUrl(submissions.find((s) => s.id === selectedVote)?.card_path || "")}
                    alt="Card to vote for"
                  />
                ) : (
                  <img className="card-img-large" src={cardUrl(selectedCard)} alt="Selected card" />
                )}
              </div>

              {isStoryteller && selectedCard && (
                <div style={{ marginTop: 20, width: "100%" }}>
                  <label htmlFor="story-prompt" className="label">
                    Write your prompt
                  </label>
                  <textarea
                    id="story-prompt"
                    className="story-input"
                    placeholder="Describe your card with a word, phrase, or sentence..."
                    value={storyPrompt}
                    onChange={(e) => setStoryPrompt(e.target.value)}
                    maxLength={200}
                    rows={3}
                  />
                </div>
              )}

              {room?.phase === "voting" && selectedVote && (() => {
                const selectedSubmission = submissions.find((s) => s.id === selectedVote);
                const isSelectedOwnCard = me && selectedSubmission && selectedSubmission.player_id === me.id;
                return (
                  <div style={{ marginTop: 20, width: "100%", textAlign: "center" }}>
                    <p className="muted" style={{ fontSize: "14px" }}>
                      {isSelectedOwnCard ? "You cannot vote for your own card" : "Vote for this card as the storyteller's card"}
                    </p>
                  </div>
                );
              })()}

              <div className="start-row" style={{ marginTop: 20, width: "100%" }}>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    setSelectedCard(null);
                    setStoryPrompt("");
                    setSelectedVote(null);
                  }}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                {room?.phase === "voting" && selectedVote ? (() => {
                  const selectedSubmission = submissions.find((s) => s.id === selectedVote);
                  const isSelectedOwnCard = me && selectedSubmission && selectedSubmission.player_id === me.id;
                  return (
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={handleVote}
                      disabled={isSelectedOwnCard}
                      style={{ flex: 1 }}
                    >
                      Vote
                    </button>
                  );
                })() : (
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={handleConfirm}
                    disabled={isStoryteller && !storyPrompt.trim()}
                    style={{ flex: 1 }}
                  >
                    Confirm {isStoryteller ? "Prompt" : "Card"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <div className="players-header">
            <h2>Your hand</h2>
            <p className="muted">{hand.length} cards</p>
          </div>

          <div className="card-grid">
            {hand.map((path) => (
              <div
                key={path}
                className={`card-tile ${selectedCard === path ? "selected" : ""} ${!canSelectCard ? "disabled" : ""}`}
                onClick={() => {
                  console.log("Card clicked:", path, "canSelectCard:", canSelectCard);
                  handleCardClick(path);
                }}
                style={{
                  cursor: canSelectCard ? "pointer" : "not-allowed",
                  opacity: canSelectCard ? 1 : 0.5,
                  transition: "all 0.2s ease",
                }}
                title={canSelectCard ? "Click to select" : "Wait for your turn"}
              >
                <img className="card-img" src={cardUrl(path)} alt="Card" />
              </div>
            ))}
            {hand.length === 0 && <p className="muted">No cards dealt yet.</p>}
          </div>
        </div>

        {status ? (
          <section
            className={`status ${
              status.includes("error") || status.includes("Failed") ? "error" : status.includes("Submitting") ? "" : "ok"
            }`}
            role="status"
            aria-live="polite"
          >
            {status}
          </section>
        ) : null}

        <div className="start-row" style={{ marginTop: 20 }}>
          <div className="muted">
            {room?.phase === "storyteller_pick" && isStoryteller
              ? "You are the storyteller. Pick a card and write a prompt."
              : room?.phase === "submit" && !isStoryteller
              ? "Choose a card that matches the prompt."
              : room?.phase === "submit" && isStoryteller
              ? "Waiting for other players to submit their cards..."
              : room?.phase === "voting"
              ? "Voting phase - waiting for votes..."
              : room?.phase === "reveal"
              ? "Round results"
              : isStoryteller
              ? "You are the storyteller this round."
              : ""}
          </div>
        </div>
          </div>

          <aside className="game-sidebar">
            <h3 className="sidebar-title">Leaderboard</h3>
            <ul className="leaderboard">
              {players.map((p) => {
                const playerStatus = getPlayerStatus(p.id);
                const initials = getInitials(p.display_name);
                const avatarColor = getAvatarColor(p.display_name);
                const isCurrentPlayer = p.client_id === clientId;
                return (
                  <li 
                    key={p.id} 
                    className="leader-row"
                    style={{
                      border: isCurrentPlayer ? `2px solid ${avatarColor}` : undefined,
                    }}
                  >
                    <div className="leader-main">
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                          className="player-avatar"
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: "50%",
                            backgroundColor: avatarColor,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#fff",
                            fontSize: "13px",
                            fontWeight: 600,
                            flexShrink: 0,
                            border: "2px solid rgba(255, 255, 255, 0.2)",
                          }}
                        >
                          {initials}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                          <span className="leader-name">
                            {p.display_name}
                            {p.is_host && <span className="leader-badge host">★</span>}
                          </span>
                          {playerStatus && (
                            <span
                              className="leader-status"
                              style={{
                                fontSize: "12px",
                                color: "var(--muted)",
                                fontWeight: playerStatus.includes("Choosing") || playerStatus.includes("Voting") ? 700 : 400,
                              }}
                            >
                              {playerStatus}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="leader-score">{p.score ?? 0}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      </main>
    </div>
  );
}


