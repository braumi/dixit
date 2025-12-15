import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const generateCode = () => {
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
};

export async function POST() {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  try {
    let code = generateCode();
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      const { data: existing } = await supabaseAdmin.from("rooms").select("id").eq("code", code).maybeSingle();
      if (!existing) break;
      code = generateCode();
      attempts += 1;
    }

    const { data, error } = await supabaseAdmin.from("rooms").insert({ code }).select("code").single();
    if (error) throw error;

    return NextResponse.json({ code: data.code });
  } catch (error) {
    console.error("Create room error:", error);
    return NextResponse.json({ error: "Failed to create room" }, { status: 500 });
  }
}

