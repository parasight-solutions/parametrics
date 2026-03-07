import "../startup/env.js";

// ✅ Explicit side-effect imports (workers register themselves on import)
import "./postGenerate.worker.js";
import "./postPublish.worker.js";
import "./reviewSync.worker.js";

console.log("[workers] started: post-generate, post-publish, review-sync");

// Optional: keep exports if anything elsewhere imports from workers/index.js
export * from "./postGenerate.worker.js";
export * from "./postPublish.worker.js";
export * from "./reviewSync.worker.js";