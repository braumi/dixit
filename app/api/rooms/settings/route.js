import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

// Allowed card sets
const CARD_SETS = new Set(["original", "custom"]);

export async function POST(req) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { code, clientId, displayName, cardSet, roundsPerPlayer } = await req.json();
  if (!code || !clientId) {
    return NextResponse.json({ error: "Missing code or clientId" }, { status: 400 });
  }

  try {
    // Fetch room with owner and id
    const { data: room, error: roomError } = await supabaseAdmin
      .from("rooms")
      .select("id, owner_player_id, phase")
      .eq("code", code.toUpperCase())
      .maybeSingle();
    if (roomError) throw roomError;
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    // Find player row
    const { data: player, error: playerError } = await supabaseAdmin
      .from("room_players")
      .select("id, is_host, display_name")
      .eq("room_id", room.id)
      .eq("client_id", clientId)
      .maybeSingle();
    if (playerError) throw playerError;
    if (!player) return NextResponse.json({ error: "Player not found in room" }, { status: 404 });

    // Only owner/host can change settings and only in lobby phase
    const isOwner = room.owner_player_id === player.id || player.is_host;
    if (!isOwner) {
      return NextResponse.json({ error: "Only the host can change settings" }, { status: 403 });
    }
    if (room.phase && room.phase !== "lobby") {
      return NextResponse.json({ error: "Settings can only be changed in lobby" }, { status: 400 });
    }

    const updates = {};
    if (cardSet && CARD_SETS.has(cardSet)) {
      updates.card_set = cardSet;
    }
    if (typeof roundsPerPlayer === "number" && roundsPerPlayer > 0 && roundsPerPlayer <= 20) {
      updates.rounds_per_player = roundsPerPlayer;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid settings to update" }, { status: 400 });
    }

    const { error: updateError, data: updated } = await supabaseAdmin
      .from("rooms")
      .update(updates)
      .eq("id", room.id)
      .select("card_set, rounds_per_player")
      .single();
    if (updateError) throw updateError;

    return NextResponse.json({ settings: updated });
  } catch (error) {
    console.error("Update settings error:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}

