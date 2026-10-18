import "dotenv/config";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set. Add your Atlas connection string to .env first.");
  process.exit(1);
}

const dbName = process.env.MONGODB_DB || "simmer";
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, family: 4 });
client.on("error", () => {});

const recipesValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["title", "ingredients", "steps", "createdAt"],
    properties: {
      title: { bsonType: "string" },
      servings: { bsonType: ["int", "double", "long", "decimal", "null"] },
      ingredients: {
        bsonType: "array",
        items: {
          bsonType: "object",
          properties: {
            qty: { bsonType: ["int", "double", "long", "decimal", "null"] },
            unit: { bsonType: "string" },
            item: { bsonType: "string" },
          },
        },
      },
      steps: { bsonType: "array", items: { bsonType: "string" } },
      times: {
        bsonType: "object",
        properties: { prep: { bsonType: "string" }, cook: { bsonType: "string" } },
      },
      tags: { bsonType: "array", items: { bsonType: "string" } },
      sourceUrl: { bsonType: "string" },
      createdAt: { bsonType: "date" },
    },
  },
};

try {
  await client.connect();
  const db = client.db(dbName);

  const existing = await db.listCollections({ name: "recipes" }).toArray();
  if (existing.length === 0) {
    await db.createCollection("recipes", {
      validator: recipesValidator,
      validationLevel: "moderate",
      validationAction: "warn",
    });
    console.log(`Created collection "${dbName}.recipes" with a JSON schema validator.`);
  } else {
    await db.command({
      collMod: "recipes",
      validator: recipesValidator,
      validationLevel: "moderate",
      validationAction: "warn",
    });
    console.log(`Updated schema validator on "${dbName}.recipes".`);
  }

  await db.collection("recipes").createIndex({ createdAt: -1 });
  await db.collection("recipes").createIndex({ tags: 1 });

  const indexes = (await db.collection("recipes").indexes()).map((i) => i.name);
  const count = await db.collection("recipes").countDocuments();

  console.log(`Database "${dbName}" is ready.`);
  console.log("Indexes:", indexes.join(", "));
  console.log("Recipes stored:", count);
} catch (err) {
  console.error("init-db failed:", err.message);
  process.exit(1);
} finally {
  await client.close().catch(() => {});
}
