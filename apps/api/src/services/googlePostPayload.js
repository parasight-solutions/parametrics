import { validateExternalImageUrl } from "./postImageStorage.js";

export function buildGoogleLocalPostPayload(post = {}) {
  const payload = {
    summary: post.summary,
    languageCode: post.language_code || post.languageCode || "en-US",
    topicType: post.topic_type || post.topicType || "STANDARD",
  };

  if (post.image_url) {
    payload.media = [{
      mediaFormat: "PHOTO",
      sourceUrl: validateExternalImageUrl(post.image_url),
    }];
  }

  if (post.call_to_action_type) {
    const actionType = String(post.call_to_action_type).trim().toUpperCase();
    payload.callToAction = { actionType };
    if (actionType !== "CALL" && post.call_to_action_url) payload.callToAction.url = post.call_to_action_url;
  } else if (post.call_to_action_url) {
    payload.callToAction = { actionType: "LEARN_MORE", url: post.call_to_action_url };
  }

  return payload;
}
