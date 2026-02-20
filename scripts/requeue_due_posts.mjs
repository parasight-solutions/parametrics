import "../apps/api/src/startup/env.js";
import { col } from "../apps/api/src/lib/mongo.js";
import { makeQueue } from "../apps/api/src/lib/queues.js";

const WINDOW_HOURS = Number(process.env.REQUEUE_WINDOW_HOURS || 24);
const LIMIT = Number(process.env.REQUEUE_LIMIT || 200);

const until = new Date(Date.now() + WINDOW_HOURS * 60 * 60 * 1000);

const posts = await col("posts");
const q = makeQueue("post-generate");

const rows = await posts.find(
  { ai_status: "pending", planned_for: { $lte: until } },
  { projection: { _id: 0, id: 1 } }
).limit(LIMIT).toArray();

let n = 0;
for (const r of rows) {
  const postId = String(r.id || "").trim();
  if (!postId) continue;
  await q.add("generate", { postId }, {
    jobId: `gen_${postId}`,
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });
  n++;
}

console.log(`enqueued ${n} due posts (<= ${until.toISOString()})`);
await q.close();
process.exit(0);
