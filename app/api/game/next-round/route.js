import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

const HAND_SIZE = 6;
const bucket = "cards";

async function listAllPaths(admin, cardSet) {
  const prefix = `${cardSet}/`;
  const results = [];
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, recursive: true });
  if (error) throw error;
  for (const item of data || []) {
    if (item.name && !item.name.endsWith("/")) {
      results.push(`${prefix}${item.name}`);
    }
  }
  return results;
}

export async function POST(request) {
  try {
    const { code, clientId } = await request.json();
    if (!code || !clientId) {
      return NextResponse.json({ error: "Missing code or clientId" }, { status: 400 });
    }

    const admin = supabaseAdmin;
    if (!admin) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    // Load room in reveal phase
    const { data: room, error: roomError } = await admin
      .from("rooms")
      .select("id, code, phase, current_round, total_rounds, storyteller_id, card_set, used_cards")
      .eq("code", code.toUpperCase())
      .maybeSingle();

    if (roomError || !room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    if (room.phase !== "reveal") {
      return NextResponse.json({ error: "Next round can only be started after reveal" }, { status: 400 });
    }

    // Allow transition to finished phase if this is the last round
    if (room.current_round > room.total_rounds) {
      return NextResponse.json({ error: "Game has finished" }, { status: 400 });
    }

    // Find caller player
    const { data: me, error: meError } = await admin
      .from("room_players")
      .select("id")
      .eq("room_id", room.id)
      .eq("client_id", clientId)
      .maybeSingle();
    if (meError || !me) {
      return NextResponse.json({ error: "Player not found in room" }, { status: 404 });
    }

    if (me.id !== room.storyteller_id) {
      return NextResponse.json({ error: "Only the current storyteller can start the next round" }, { status: 403 });
    }

    // Load players ordered by joined_at
    const { data: players, error: playersError } = await admin
      .from("room_players")
      .select("id, hand")
      .eq("room_id", room.id)
      .order("joined_at", { ascending: true });
    if (playersError || !players?.length) {
      return NextResponse.json({ error: "No players in room" }, { status: 400 });
    }

    // Load submissions for current round to know which card each player used
    const { data: subs, error: subsError } = await admin
      .from("submissions")
      .select("player_id, card_path")
      .eq("room_id", room.id)
      .eq("round_number", room.current_round);
    if (subsError) {
      return NextResponse.json({ error: "Failed to load submissions" }, { status: 500 });
    }

    const usedByPlayer = new Map();
    for (const s of subs || []) {
      usedByPlayer.set(s.player_id, s.card_path);
    }

    const cardSet = room.card_set === "custom" ? "custom" : "original";
    const allPaths = await listAllPaths(admin, cardSet);

    const usedCards = Array.isArray(room.used_cards) ? [...room.used_cards] : [];
    const available = allPaths.filter((p) => !usedCards.includes(p));

    // Need one new card per player
    if (available.length < players.length) {
      return NextResponse.json({ error: "Not enough unused cards to continue" }, { status: 400 });
    }

    // Simple random selection
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const newCards = shuffled.slice(0, players.length);

    // Update each player's hand: remove used card, add a new one
    for (let i = 0; i < players.length; i += 1) {
      const p = players[i];
      const hand = Array.isArray(p.hand) ? [...p.hand] : [];
      const played = usedByPlayer.get(p.id);
      const newCard = newCards[i];

      if (played) {
        const idx = hand.indexOf(played);
        if (idx !== -1) {
          hand.splice(idx, 1);
        }
      }
      if (hand.length < HAND_SIZE) {
        hand.push(newCard);
      }

      const { error: handError } = await admin
        .from("room_players")
        .update({ hand })
        .eq("id", p.id);
      if (handError) {
        return NextResponse.json({ error: "Failed to update hands" }, { status: 500 });
      }
    }

    // Mark newly dealt cards as used
    const nextUsed = [...usedCards, ...newCards];

    // Rotate storyteller for next round
    const currentIndex = players.findIndex((p) => p.id === room.storyteller_id);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % players.length;
    const nextStorytellerId = players[nextIndex].id;

    const nextRound = room.current_round + 1;
    const isGameFinished = nextRound > room.total_rounds;

    const { error: roomUpdateError } = await admin
      .from("rooms")
      .update({
        current_round: nextRound,
        storyteller_id: nextStorytellerId,
        phase: isGameFinished ? "finished" : "storyteller_pick",
        story_text: null,
        used_cards: nextUsed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", room.id);

    if (roomUpdateError) {
      return NextResponse.json({ error: "Failed to update room for next round" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Next round error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


