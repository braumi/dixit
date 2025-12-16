import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function POST(request) {
  try {
    const { code, clientId, cardPath } = await request.json();

    if (!code || !clientId || !cardPath) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const admin = supabaseAdmin;
    if (!admin) {
      return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
    }

    // Get room and player
    const { data: room, error: roomError } = await admin
      .from("rooms")
      .select("id, storyteller_id, current_round, phase")
      .eq("code", code.toUpperCase())
      .maybeSingle();

    if (roomError || !room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    if (room.phase !== "submit") {
      return NextResponse.json({ error: "Not in submit phase" }, { status: 400 });
    }

    const { data: player, error: playerError } = await admin
      .from("room_players")
      .select("id, hand")
      .eq("room_id", room.id)
      .eq("client_id", clientId)
      .maybeSingle();

    if (playerError || !player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    if (player.id === room.storyteller_id) {
      return NextResponse.json({ error: "Storyteller already submitted" }, { status: 400 });
    }

    // Check if card is in player's hand
    const hand = Array.isArray(player.hand) ? player.hand : [];
    if (!hand.includes(cardPath)) {
      return NextResponse.json({ error: "Card not in your hand" }, { status: 400 });
    }

    // Check if player already submitted
    const { data: existing } = await admin
      .from("submissions")
      .select("id")
      .eq("room_id", room.id)
      .eq("round_number", room.current_round)
      .eq("player_id", player.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "You already submitted a card" }, { status: 400 });
    }

    // Remove card from hand
    const updatedHand = hand.filter((path) => path !== cardPath);

    // Create submission record
    const { error: subError } = await admin.from("submissions").insert({
      room_id: room.id,
      round_number: room.current_round,
      player_id: player.id,
      card_path: cardPath,
      is_storyteller_card: false,
    });

    if (subError) {
      console.error("Error creating submission:", subError);
      return NextResponse.json({ error: "Failed to submit card" }, { status: 500 });
    }

    // Update player's hand
    const { error: handUpdateError } = await admin
      .from("room_players")
      .update({ hand: updatedHand })
      .eq("id", player.id);

    if (handUpdateError) {
      console.error("Error updating hand:", handUpdateError);
      // Don't fail the request, but log it
    }

    // Check if all non-storyteller players have submitted
    const { data: allPlayers } = await admin
      .from("room_players")
      .select("id")
      .eq("room_id", room.id);

    const { data: allSubmissions } = await admin
      .from("submissions")
      .select("player_id")
      .eq("room_id", room.id)
      .eq("round_number", room.current_round);

    const nonStorytellerCount = (allPlayers || []).filter((p) => p.id !== room.storyteller_id).length;
    const submittedCount = (allSubmissions || []).length;

    // If all players (including storyteller) have submitted, move to voting phase
    if (submittedCount >= nonStorytellerCount + 1) {
      await admin
        .from("rooms")
        .update({
          phase: "voting",
          updated_at: new Date().toISOString(),
        })
        .eq("id", room.id);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error submitting card:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

