// apps/api/src/services/postAi.js
import "../startup/env.js";
import OpenAI from "openai";

let _client = null;
let _clientKey = null;

function getClient() {
  const key = String(process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("OPENAI_API_KEY not set");

  // recreate client only if key changed
  if (_client && _clientKey === key) return _client;

  _clientKey = key;
  _client = new OpenAI({ apiKey: key });
  return _client;
}

function safeJsonParse(text) {
  const s = String(text || "").trim();
  try { return JSON.parse(s); } catch {}

  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i >= 0 && j > i) {
    try { return JSON.parse(s.slice(i, j + 1)); } catch {}
  }
  return null;
}

export async function generateGbpPost({ org, locationTitle, whenLocalStr, seedPrompt }) {
  const client = getClient();
  const model = process.env.OPENAI_POST_MODEL || "gpt-4o-mini";

  const payload = {
    org: {
      name: org.name,
      website: org.website,
      industry: org.industry,
      description: org.description,
      brand_voice: org.brand_voice || {},
      keywords: org.keywords || [],
      language_code: org.language_code || "en-IN",
    },
    location: { title: locationTitle },
    schedule: { whenLocal: whenLocalStr },
    seedPrompt: seedPrompt || "",
    constraints: {
      maxChars: 1200,
      avoid: ["fake claims", "guarantees", "misleading pricing", "ALL CAPS spam", "too many emojis"],
    },
    output: "json",
  };

  const resp = await client.responses.create({
    model,
    input: [
      { role: "system", content: "You write short, high-converting Google Business Profile posts. Return ONLY valid JSON." },
      {
        role: "user",
        content:
          "Generate a GBP post using this data. Output JSON with keys: summary (string), hashtags (string[] up to 8), image_prompt (string, optional). No markdown.\n\n" +
          JSON.stringify(payload),
      },
    ],
  });

  const text = resp.output_text || "";
  const obj = safeJsonParse(text);

  const summary = String(obj?.summary || "").trim();
  if (!summary) throw new Error("AI returned empty summary");

  const hashtags = Array.isArray(obj?.hashtags)
    ? obj.hashtags.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8)
    : [];

  const imagePrompt = obj?.image_prompt ? String(obj.image_prompt).trim() : null;

  return { summary, hashtags, imagePrompt, modelUsed: model };
}
