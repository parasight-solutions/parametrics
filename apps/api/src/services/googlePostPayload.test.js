import test from "node:test";
import assert from "node:assert/strict";
import { buildGoogleLocalPostPayload } from "./googlePostPayload.js";

test("text-only Google payload omits media and preserves core fields", () => {
  assert.deepEqual(buildGoogleLocalPostPayload({ summary: "Hello", topic_type: "STANDARD", language_code: "en-US" }), {
    summary: "Hello",
    languageCode: "en-US",
    topicType: "STANDARD",
  });
});

test("image Google payload includes PHOTO media format and unchanged source URL", () => {
  const imageUrl = "https://cdn.example.org/render?id=42&format=webp";
  assert.deepEqual(buildGoogleLocalPostPayload({ summary: "Hello", image_url: imageUrl }), {
    summary: "Hello",
    languageCode: "en-US",
    topicType: "STANDARD",
    media: [{ mediaFormat: "PHOTO", sourceUrl: imageUrl }],
  });
});

test("Google payload preserves configured CTA behavior", () => {
  assert.deepEqual(buildGoogleLocalPostPayload({ summary: "Hello", call_to_action_type: "CALL", call_to_action_url: "https://ignored.example" }).callToAction, { actionType: "CALL" });
  assert.deepEqual(buildGoogleLocalPostPayload({ summary: "Hello", call_to_action_url: "https://example.org" }).callToAction, { actionType: "LEARN_MORE", url: "https://example.org" });
});
