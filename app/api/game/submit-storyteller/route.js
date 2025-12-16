import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function POST(request) {
  try {
    const { code, clientId, cardPath, prompt } = await request.json();

    if (!code || !clientId || !cardPath || !prompt?.trim()) {
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

    if (room.phase !== "storyteller_pick") {
      return NextResponse.json({ error: "Not in storyteller pick phase" }, { status: 400 });
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

    if (player.id !== room.storyteller_id) {
      return NextResponse.json({ error: "Only storyteller can submit prompt" }, { status: 403 });
    }

    // Check if card is in player's hand and remove it
    const hand = Array.isArray(player.hand) ? player.hand : [];
    if (!hand.includes(cardPath)) {
      return NextResponse.json({ error: "Card not in your hand" }, { status: 400 });
    }

    // Remove card from hand
    const updatedHand = hand.filter((path) => path !== cardPath);

    // Update player's hand
    const { error: handUpdateError } = await admin
      .from("room_players")
      .update({ hand: updatedHand })
      .eq("id", player.id);

    if (handUpdateError) {
      console.error("Error updating hand:", handUpdateError);
      return NextResponse.json({ error: "Failed to update hand" }, { status: 500 });
    }

    // Update room with story text and move to submit phase
    const { error: updateError } = await admin
      .from("rooms")
      .update({
        story_text: prompt.trim(),
        phase: "submit",
        updated_at: new Date().toISOString(),
      })
      .eq("id", room.id);

    if (updateError) {
      return NextResponse.json({ error: "Failed to update room" }, { status: 500 });
    }

    // Create submission record for storyteller's card
    const { error: subError } = await admin.from("submissions").insert({
      room_id: room.id,
      round_number: room.current_round,
      player_id: player.id,
      card_path: cardPath,
      is_storyteller_card: true,
    });

    if (subError) {
      console.error("Error creating submission:", subError);
      // Don't fail the request, but log it
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error submitting storyteller prompt:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

