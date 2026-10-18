import { MongoClient, ObjectId } from "mongodb";

let collection = null;
let inMemory = false;
const memory = [];

export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    inMemory = true;
    console.log("No MONGODB_URI set - using in-memory store (data resets on restart).");
    return;
  }
  try {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, family: 4 });
    client.on("error", (err) => console.error("MongoDB client error:", err.message));
    await client.connect();
    await client.db(process.env.MONGODB_DB || "simmer").command({ ping: 1 });
    collection = client.db(process.env.MONGODB_DB || "simmer").collection("recipes");
    console.log("Connected to MongoDB Atlas.");
  } catch (err) {
    inMemory = true;
    const msg = err.message || "";
    if (/SSL alert number 80|tlsv1 alert internal error/i.test(msg)) {
      console.error(
        "MongoDB refused the connection (your IP is likely not allowed in Atlas Network Access). Using the in-memory store. Run `npm run check-db` for your current IP."
      );
    } else {
      console.error("MongoDB connection failed, using in-memory store instead:", msg);
    }
  }
}

export function dbMode() {
  return inMemory ? "memory" : "atlas";
}

function objectId(id) {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}

export async function saveRecipe(doc, ownerId = "guest") {
  const record = { ...doc, ownerId };
  if (inMemory) {
    const id = String(Date.now());
    memory.unshift({ ...record, _id: id });
    return id;
  }
  const res = await collection.insertOne(record);
  return res.insertedId.toString();
}

export async function listRecipes(ownerId = "guest") {
  if (inMemory) return memory.filter((r) => r.ownerId === ownerId).map((r) => ({ ...r }));
  const docs = await collection
    .find({ ownerId })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray();
  return docs.map((d) => ({ ...d, _id: d._id.toString() }));
}

export async function getRecipe(id, ownerId) {
  if (inMemory) {
    return (
      memory.find((r) => r._id === id && (ownerId ? r.ownerId === ownerId : true)) || null
    );
  }
  const _id = objectId(id);
  if (!_id) return null;
  const filter = ownerId ? { _id, ownerId } : { _id };
  const doc = await collection.findOne(filter);
  return doc ? { ...doc, _id: doc._id.toString() } : null;
}

export async function saveTranslation(id, language, data, ownerId) {
  if (inMemory) {
    const doc = memory.find(
      (r) => r._id === id && (ownerId ? r.ownerId === ownerId : true)
    );
    if (doc) {
      doc.translations = { ...(doc.translations || {}), [language]: data };
    }
    return;
  }
  const _id = objectId(id);
  if (!_id) return;
  const filter = ownerId ? { _id, ownerId } : { _id };
  await collection.updateOne(filter, { $set: { [`translations.${language}`]: data } });
}

export async function setRecipeImage(id, image, ownerId) {
  if (inMemory) {
    const doc = memory.find(
      (r) => r._id === id && (ownerId ? r.ownerId === ownerId : true)
    );
    if (doc) doc.image = image;
    return;
  }
  const _id = objectId(id);
  if (!_id) return;
  const filter = ownerId ? { _id, ownerId } : { _id };
  await collection.updateOne(filter, { $set: { image } });
}

export async function claimRecipes(ownerId, { all = false } = {}) {
  if (!ownerId) throw new Error("ownerId is required");
  if (inMemory) {
    let changed = 0;
    for (const r of memory) {
      if (all || !r.ownerId) {
        r.ownerId = ownerId;
        changed += 1;
      }
    }
    return { matchedCount: changed, modifiedCount: changed };
  }
  const filter = all
    ? {}
    : { $or: [{ ownerId: { $exists: false } }, { ownerId: null }, { ownerId: "" }] };
  const res = await collection.updateMany(filter, { $set: { ownerId } });
  return { matchedCount: res.matchedCount, modifiedCount: res.modifiedCount };
}

export async function deleteRecipe(id, ownerId) {
  if (inMemory) {
    const i = memory.findIndex(
      (r) => r._id === id && (ownerId ? r.ownerId === ownerId : true)
    );
    if (i > -1) memory.splice(i, 1);
    return;
  }
  const _id = objectId(id);
  if (!_id) return;
  const filter = ownerId ? { _id, ownerId } : { _id };
  await collection.deleteOne(filter);
}
