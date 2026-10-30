const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws"); // necesario en Node < 22, que no trae WebSocket nativo

if (!process.env.SUPABASE_URL) {
  console.warn("SUPABASE_URL no está definida.");
}

const realtimeOptions = { realtime: { transport: WebSocket } };

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  realtimeOptions
);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  realtimeOptions
);

module.exports = { supabase, supabaseAdmin };