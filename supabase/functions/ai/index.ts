// Proxy de IA (Google Gemini) — Supabase Edge Function "ai".
// Referencia versionada de la función desplegada en el proyecto jvjhqdwlhaggoqsnenfw.
//
// Seguridad: sólo los miembros de la allowlist (tabla `miembros`, vía is_member())
// pueden invocarla; la clave de Gemini vive únicamente en el servidor
// (variable GEMINI_API_KEY o, como respaldo, la tabla privada app_secrets).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "gemini-3.5-flash";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function geminiKey(): Promise<string> {
  const envKey = Deno.env.get("GEMINI_API_KEY");
  if (envKey) return envKey;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data } = await admin.from("app_secrets").select("value").eq("name", "GEMINI_API_KEY").single();
  return data?.value || "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // Sólo miembros de la allowlist pueden usar la IA.
    const authHeader = req.headers.get("Authorization") || "";
    const sb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: ok } = await sb.rpc("is_member");
    if (!ok) return json({ error: "No autorizado." }, 403);

    const key = await geminiKey();
    if (!key) return json({ error: "Falta la clave de Gemini en el servidor." }, 500);

    const { system, messages = [], maxTokens = 1500, model } = await req.json();
    const body: Record<string, unknown> = {
      contents: (messages as Array<{ role: string; content: string }>).map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: maxTokens },
    };
    if (system) body.system_instruction = { parts: [{ text: system }] };

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model || MODEL}:generateContent?key=${key}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    );
    const data = await r.json();
    if (!r.ok) return json({ error: data?.error?.message || "Error de la API de IA." }, 502);
    const blocked = data?.promptFeedback?.blockReason;
    if (blocked) return json({ error: "La IA ha bloqueado la petición (" + blocked + ")." }, 502);
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p: { text?: string }) => p?.text || "")
      .join("");
    return json({ text });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
