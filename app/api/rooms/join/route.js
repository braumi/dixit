import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

const MAX_PLAYERS = 8;

export async function POST(req) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { code, displayName, clientId } = await req.json();
  if (!code || !displayName || !clientId) {
    return NextResponse.json({ error: "Missing code, displayName, or clientId" }, { status: 400 });
  }

  try {
    const { data: room, error: roomError } = await supabaseAdmin
      .from("rooms")
      .select("id, owner_player_id, phase")
      .eq("code", code.toUpperCase())
      .maybeSingle();
    if (roomError) throw roomError;
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    // Block new joins if game already started
    if (room.phase && room.phase !== "lobby") {
      return NextResponse.json({ error: "Game has already started" }, { status: 409 });
    }

    const { count, error: countError } = await supabaseAdmin
      .from("room_players")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_PLAYERS) {
      return NextResponse.json({ error: "Room is full" }, { status: 409 });
    }

    const { data: upserted, error: upsertError } = await supabaseAdmin
      .from("room_players")
      .upsert(
        { room_id: room.id, client_id: clientId, display_name: displayName.trim() },
        { onConflict: "room_id,client_id" }
      )
      .select("id, display_name, client_id, score, joined_at, is_host")
      .single();
    if (upsertError) throw upsertError;

    // If no owner yet, set this player as owner/host
    if (!room.owner_player_id) {
      const { error: setOwnerError } = await supabaseAdmin
        .from("rooms")
        .update({ owner_player_id: upserted.id })
        .eq("id", room.id);
      if (setOwnerError) console.warn("Failed to set owner_player_id", setOwnerError);

      const { error: markHostError } = await supabaseAdmin
        .from("room_players")
        .update({ is_host: true })
        .eq("id", upserted.id);
      if (markHostError) console.warn("Failed to mark host", markHostError);
      upserted.is_host = true;
    }

    const { data: players, error: playersError } = await supabaseAdmin
      .from("room_players")
      .select("id, display_name, client_id, score, joined_at, is_host")
      .eq("room_id", room.id)
      .order("joined_at", { ascending: true });
    if (playersError) throw playersError;

    return NextResponse.json({ player: upserted, players });
  } catch (error) {
    console.error("Join room error:", error);
    return NextResponse.json({ error: "Failed to join room" }, { status: 500 });
  }
}

