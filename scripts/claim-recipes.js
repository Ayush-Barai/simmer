import "dotenv/config";
import { createClerkClient } from "@clerk/backend";
import {
  claimRecipes,
  connectDb,
  dbMode,
  listRecipes,
  setRecipeImage,
} from "../server/db.js";
import { fetchPageImage } from "../server/ingest.js";

const secretKey = (process.env.CLERK_SECRET_KEY || "").trim();
if (!secretKey) {
  console.error("Set CLERK_SECRET_KEY in .env first.");
  process.exit(1);
}

await connectDb();
if (dbMode() === "memory") {
  console.error("No MongoDB connection, so there is nothing persistent to claim.");
  process.exit(1);
}

const clerk = createClerkClient({ secretKey });
const listing = await clerk.users.getUserList({ limit: 50 });
const users = listing.data || listing;

if (!users.length) {
  console.error(
    "No Clerk users yet. Open Simmer, sign up once, then run `npm run claim` again."
  );
  process.exit(1);
}

const target = (process.argv[2] || "").trim().toLowerCase();
let user = null;

if (target) {
  user = users.find(
    (u) =>
      u.id.toLowerCase() === target ||
      (u.primaryEmailAddress?.emailAddress || "").toLowerCase() === target
  );
  if (!user) {
    console.error(`No Clerk user matches "${process.argv[2]}".`);
    process.exit(1);
  }
} else if (users.length === 1) {
  user = users[0];
} else {
  console.error("Multiple Clerk users found. Pass one id or email:");
  for (const u of users) {
    console.error(`  ${u.id}  ${u.primaryEmailAddress?.emailAddress || "(no email)"}`);
  }
  process.exit(1);
}

const before = await listRecipes(user.id);
const result = await claimRecipes(user.id, { all: process.argv.includes("--all") });
const after = await listRecipes(user.id);

console.log(
  `Assigned ${result.modifiedCount} recipe(s) to ${user.id} (${
    user.primaryEmailAddress?.emailAddress || "no email"
  }).`
);
console.log(`That account now has ${after.length} recipe(s) (was ${before.length}).`);

let images = 0;
for (const recipe of after) {
  if (recipe.image || !recipe.sourceUrl) continue;
  const image = await fetchPageImage(recipe.sourceUrl);
  if (image) {
    await setRecipeImage(recipe._id, image, user.id);
    images += 1;
  }
}
if (images) console.log(`Backfilled ${images} thumbnail(s) from the original links.`);
process.exit(0);
