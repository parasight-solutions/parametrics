// apps/api/src/services/postGenerator.js
// apps/api/src/services/postGenerator.js
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { col } from "../lib/mongo.js";
import { resolveCanonicalLocationScope } from "./locationBinding.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-5";
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";

const MIN_SCORE = Number(process.env.AI_IMAGE_MIN_SCORE || 7);
const OUT_DIR = process.env.GENERATED_IMAGE_DIR || "uploads/generated";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function safeJsonParse(s) {
  const raw = String(s || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    // try to extract JSON block
    const m = raw.match(/\{[\s\S]*\}$/);
    if (m) return JSON.parse(m[0]);
    throw new Error("AI returned non-JSON output");
  }
}

function dataUrlFromBuffer(buf) {
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function scoreImage(buffer) {
  // Vision scoring via Responses API; response.output_text supported 
  const resp = await openai.responses.create({
    model: VISION_MODEL,
    temperature: 0,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `Score this image for use as a professional business social post image.
Return ONLY JSON: {"score":0-10,"issues":[...],"hasText":true|false,"hasWatermark":true|false,"isBlurry":true|false}.
Prefer: sharp, clean, realistic, no weird artifacts, no text, no watermarks.`,
          },
          {
            type: "input_image",
            // Responses API supports base64 data URLs :contentReference[oaicite:6]{index=6}
            image_url: dataUrlFromBuffer(buffer),
          },
        ],
      },
    ],
  });

  const out = safeJsonParse(resp.output_text);
  return {
    score: Number(out.score || 0),
    issues: Array.isArray(out.issues) ? out.issues.slice(0, 10) : [],
    hasText: !!out.hasText,
    hasWatermark: !!out.hasWatermark,
    isBlurry: !!out.isBlurry,
  };
}

async function generateImagePng(prompt) {
  // Images API supports size + b64_json output :contentReference[oaicite:7]{index=7}
  const result = await openai.images.generate({
    model: IMAGE_MODEL,
    prompt,
    size: "1024x1024",
    // some docs show url default; b64_json supported :contentReference[oaicite:8]{index=8}
    response_format: "b64_json",
    n: 2,
  });

  const imgs = (result?.data || [])
    .map((x) => x?.b64_json)
    .filter(Boolean)
    .map((b64) => Buffer.from(b64, "base64"));

  if (!imgs.length) throw new Error("image_generation_failed");
  return imgs;
}

export async function generateForPost(postId) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

  const posts = await col("posts");
  const locations = await col("locations");
  const orgs = await col("orgs");

  const post = await posts.findOne({ id: postId }, { projection: { _id: 0 } });
  if (!post) throw new Error("post_not_found");

  // idempotent
  if (post.content_status === "ready") return { ok: true, skipped: true };

  const loc = await locations.findOne(
    { id: post.location_id, user_id: post.user_id },
    {
      projection: {
        _id: 0,
        id: 1,
        title: 1,
        name: 1,
        provider_location_name: 1,
        organization_id: 1,
        client_id: 1,
        org_id: 1,
      },
    }
  );

  const locationScope = resolveCanonicalLocationScope(loc);
  const orgId = locationScope.effective.organization_id;
  const org = orgId
    ? await orgs.findOne({ id: orgId, user_id: post.user_id }, { projection: { _id: 0 } })
    : null;

  const locationTitle = loc?.title || loc?.name || loc?.provider_location_name || post.location_id;

  const onboarding = org?.onboarding || {};
  const brief = post.content_brief || post.summary_seed || post.summary || "";

  const wantImage = !!post.ai_image_enabled;

  const prompt = {
    locationTitle,
    brief,
    org: org
      ? {
          name: org.name,
          website: org.website,
          industry: org.industry,
          description: org.description,
          onboarding,
          brand: org.brand || {},
        }
      : null,
    rules: {
      maxChars: 1200,
      noHashtagSpam: true,
      includeCallToActionIfRelevant: true,
      language: onboarding.language || "en",
    },
  };

  const resp = await openai.responses.create({
    model: TEXT_MODEL,
    temperature: 0.7,
    input: [
      {
        role: "system",
        content:
          "You write high-converting Google Business Profile posts. Output STRICT JSON only.",
      },
      {
        role: "user",
        content: `Create GBP post copy using this JSON context:\n${JSON.stringify(prompt)}\n\nReturn ONLY JSON:\n{\n  "summary": "string <= 1200 chars",\n  "image_prompt": "string (only if image requested; NO TEXT in image; photorealistic; no watermark)"\n}\n\nImage requested: ${wantImage ? "yes" : "no"}.`,
      },
    ],
  });

  let parsed;
  try {
    parsed = safeJsonParse(resp.output_text);
  } catch (e) {
    await posts.updateOne(
      { id: postId },
      {
        $set: {
          content_status: "error",
          content_error: "ai_non_json",
          updated_at: new Date(),
        },
      }
    );
    throw e;
  }

  const summary = String(parsed.summary || "").trim();
  if (!summary) {
    await posts.updateOne(
      { id: postId },
      {
        $set: {
          content_status: "error",
          content_error: "empty_summary",
          updated_at: new Date(),
        },
      }
    );
    throw new Error("empty_summary");
  }

  // save text first (even if image later fails)
  await posts.updateOne(
    { id: postId },
    {
      $set: {
        summary,
        content_status: "ready",
        content_error: null,
        generated_at: new Date(),
        updated_at: new Date(),
      },
    }
  );

  // image pipeline (optional)
  if (!wantImage) return { ok: true, image: "skipped" };

  const imagePrompt = String(parsed.image_prompt || "").trim();
  if (!imagePrompt) {
    await posts.updateOne(
      { id: postId },
      {
        $set: {
          image_status: "error",
          image_error: "missing_image_prompt",
          updated_at: new Date(),
        },
      }
    );
    return { ok: true, image: "no_prompt" };
  }

  ensureDir(OUT_DIR);

  let buffers;
  try {
    buffers = await generateImagePng(imagePrompt);
  } catch (e) {
    await posts.updateOne(
      { id: postId },
      {
        $set: {
          image_status: "error",
          image_error: e?.message || "image_generation_failed",
          updated_at: new Date(),
        },
      }
    );
    return { ok: true, image: "failed" };
  }

  // score candidates; keep best
  let best = { score: -1, buffer: null, meta: null };
  for (const buf of buffers) {
    try {
      const meta = await scoreImage(buf);
      if (meta.score > best.score) best = { score: meta.score, buffer: buf, meta };
    } catch {
      // ignore scoring failure; do not accept blindly
    }
  }

  if (!best.buffer || best.score < MIN_SCORE) {
    await posts.updateOne(
      { id: postId },
      {
        $set: {
          image_status: "error",
          image_error: `low_quality(score=${best.score})`,
          image_quality: best.meta || null,
          updated_at: new Date(),
        },
      }
    );
    return { ok: true, image: "rejected" };
  }

  const filename = `${postId}_${Date.now()}.png`;
  const filePath = path.join(OUT_DIR, filename);
  fs.writeFileSync(filePath, best.buffer);

  // IMPORTANT: server already serves /uploads static
  const publicUrl = `/${OUT_DIR.replace(/^\/+/, "")}/${filename}`;

  await posts.updateOne(
    { id: postId },
    {
      $set: {
        image_url: publicUrl,
        image_status: "ready",
        image_error: null,
        image_quality: best.meta || null,
        updated_at: new Date(),
      },
    }
  );

  return { ok: true, image: "ready", score: best.score };
}
