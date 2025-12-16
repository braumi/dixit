import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function POST(request) {
  try {
    const { code, clientId, resetCards } = await request.json();
    if (!code || !clientId) {
      return NextResponse.json({ error: "Missing code or clientId" }, { status: 400 });
    }

    const admin = supabaseAdmin;
    if (!admin) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    // Get room
    const { data: room, error: roomError } = await admin
      .from("rooms")
      .select("id, phase, owner_player_id, used_cards")
      .eq("code", code.toUpperCase())
      .maybeSingle();

    if (roomError || !room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    // Get the caller player
    const { data: player, error: playerError } = await admin
      .from("room_players")
      .select("id, is_host")
      .eq("room_id", room.id)
      .eq("client_id", clientId)
      .maybeSingle();

    if (playerError || !player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    // Only host can restart (check both is_host flag and owner_player_id)
    const isHost = player.is_host || player.id === room.owner_player_id;
    if (!isHost) {
      return NextResponse.json({ error: "Only the host can restart the game" }, { status: 403 });
    }

    // Get all players
    const { data: players, error: playersError } = await admin
      .from("room_players")
      .select("id")
      .eq("room_id", room.id)
      .order("joined_at", { ascending: true });

    if (playersError || !players?.length) {
      return NextResponse.json({ error: "No players in room" }, { status: 400 });
    }

    // Reset all player scores and hands
    for (let i = 0; i < players.length; i += 1) {
      const { error: handError } = await admin
        .from("room_players")
        .update({ hand: [], score: 0 })
        .eq("id", players[i].id);
      if (handError) {
        return NextResponse.json({ error: "Failed to reset players" }, { status: 500 });
      }
    }

    // Reset used_cards if resetCards is true
    let usedCards = Array.isArray(room.used_cards) ? room.used_cards : [];
    if (resetCards) {
      usedCards = [];
    }

    // Reset room state back to lobby
    const { error: resetError } = await admin
      .from("rooms")
      .update({
        phase: "lobby",
        current_round: null,
        total_rounds: null,
        storyteller_id: null,
        story_text: null,
        used_cards: usedCards,
        updated_at: new Date().toISOString(),
      })
      .eq("id", room.id);

    if (resetError) {
      return NextResponse.json({ error: "Failed to reset game" }, { status: 500 });
    }

    // Clear submissions for this room
    const { error: subsDeleteError } = await admin
      .from("submissions")
      .delete()
      .eq("room_id", room.id);

    if (subsDeleteError) {
      console.error("Failed to clear submissions:", subsDeleteError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error restarting game:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

