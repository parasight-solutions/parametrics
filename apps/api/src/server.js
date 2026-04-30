// apps/api/src/server.js
// import "dotenv/config"
import "./startup/env.js"
import express from "express"
import helmet from "helmet"
import cors from "cors"
import path from "node:path"
import { ensureIndexes } from "./startup/ensureIndexes.js"
import auth from "./routes/auth.js"
import googleIntegration from "./routes/integrations.google.js"
import googleExtras from "./routes/integrations.google.extras.js"
import uploads from "./routes/uploads.js"
import debugRoutes from "./routes/debug.js"
import debugGoogle from "./routes/debug.google.js"
// Robust route imports: support either `export default` OR `export const locations/posts/reviews = Router()`
import * as locationsMod from "./routes/locations.js"
import * as postsMod from "./routes/posts.js"
import * as reviewsMod from "./routes/reviews.js"
import orgsRouter from "./routes/orgs.js";
import locationOrgRouter from "./routes/locationOrg.js";
import recurrenceRouter from "./routes/recurrence.js";
import googleAuthRouter from "./routes/auth.google.js";


const locationsRoutes = locationsMod.default || locationsMod.locations
const postsRoutes = postsMod.default || postsMod.posts
const reviewsRoutes = reviewsMod.default || reviewsMod.reviews

if (!locationsRoutes) throw new Error("routes/locations.js must export default or named `locations`")
if (!postsRoutes) throw new Error("routes/posts.js must export default or named `posts`")
if (!reviewsRoutes) throw new Error("routes/reviews.js must export default or named `reviews`")

const app = express()

app.use(
  cors({
    origin: (origin, cb) => cb(null, true), // dev: allow all
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
)

app.use(helmet())
app.use(express.json())

app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")))

app.get("/api/v1/health", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
)

app.use("/api/v1/auth", auth)
app.use("/api/v1/auth/google", googleAuthRouter)

// Google routes (same base path; both routers mounted)
app.use("/api/v1/integrations/google", googleIntegration)
app.use("/api/v1/integrations/google", googleExtras)

// Core app resources
app.use("/api/v1/locations", locationsRoutes)
app.use("/api/v1/posts", postsRoutes)
app.use("/api/v1/reviews", reviewsRoutes)
app.use("/api/v1/uploads", uploads)

// Debug
app.use("/api/v1", debugRoutes)
app.use("/api/v1/debug", debugGoogle)

app.use("/api/v1/recurrence", recurrenceRouter);
app.use("/api/v1/orgs", orgsRouter);
app.use("/api/v1/location-org", locationOrgRouter);

console.log(
  "[env] APP_ENC_KEY set =",
  !!(process.env.APP_ENC_KEY || process.env.ENCRYPTION_KEY),
  " JWT_SECRET set =",
  !!process.env.JWT_SECRET,
  " MONGODB_URI set =",
  !!process.env.MONGODB_URI
)


const port = Number(process.env.PORT || 5050)

ensureIndexes().then(() => {
  app.listen(port, () => console.log(`API listening on http://localhost:${port}`))
})