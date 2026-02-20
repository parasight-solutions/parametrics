import "dotenv/config";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { col } from "../lib/mongo.js";

async function main() {
  const email = "admin@example.com";
  const plain = "Admin@123456";
  const now = new Date();
  const users = await col("users");

  const hash = await bcrypt.hash(plain, 10);
  const existing = await users.findOne({ email });

  if (!existing) {
    const id = crypto.randomUUID();
    await users.insertOne({
      id,
      email,
      password: hash,
      role: "admin",
      status: "active",
      created_at: now,
      updated_at: now,
    });
    console.log("✅ Inserted admin:", email);
  } else {
    await users.updateOne(
      { email },
      { $set: { password: hash, role: "admin", status: "active", updated_at: now } }
    );
    console.log("✅ Updated admin password:", email);
  }
}

main().then(()=>process.exit(0)).catch(e => { console.error(e); process.exit(1); });
