import "dotenv/config";
import dns from "node:dns/promises";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.log("MONGODB_URI is not set. The app will use the in-memory store.");
  process.exit(0);
}

{
  const flags = [];
  if (uri !== uri.trim()) flags.push("leading/trailing whitespace");
  if (/^[\uFEFF\u200B]/.test(uri)) flags.push("hidden BOM/zero-width char");
  if (/^["']/.test(uri)) flags.push("surrounding quotes");
  console.log(`Raw MONGODB_URI length: ${uri.length}`);
  if (flags.length) console.error("Problem detected:", flags.join(", "));
}

if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
  console.error(`MONGODB_URI does not look like a connection string.`);
  console.error(`It is currently set to: ${JSON.stringify(uri)}`);
  console.error("");
  console.error("It should look like:");
  console.error("  mongodb+srv://<user>:<pass>@<cluster>.xxxxx.mongodb.net/?retryWrites=true&w=majority");
  console.error("");
  console.error("Create a free cluster at https://cloud.mongodb.com, then:");
  console.error("  Cluster -> Connect -> Drivers -> copy the connection string,");
  console.error("  and replace only the <password> placeholder.");
  process.exit(1);
}

{
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, "");
  const at = withoutScheme.lastIndexOf("@");
  if (at === -1) {
    console.error("Auth problem: the URI has no username/password (no \"@\").");
  } else {
    const userinfo = withoutScheme.slice(0, at);
    const colon = userinfo.indexOf(":");
    const user = colon === -1 ? userinfo : userinfo.slice(0, colon);
    const pass = colon === -1 ? "" : userinfo.slice(colon + 1);
    const problems = [];
    if (user.includes("<") || user.includes(">")) problems.push("username is still a <placeholder>");
    if (pass === "") problems.push("password is empty");
    else if (pass.includes("<") || pass.includes(">")) problems.push("password is still a <placeholder>");
    else if (/[@:/?#[\]%]/.test(decodeURIComponent(pass.replace(/%[0-9A-Fa-f]{2}/g, ""))))
      problems.push("password has special characters that must be URL-encoded");
    if (problems.length) console.error("Auth problem detected:", problems.join("; "));
  }
}

function parseHost(value) {
  const srv = value.startsWith("mongodb+srv://");
  const withoutScheme = value.replace(/^mongodb(\+srv)?:\/\//, "");
  const afterAt = withoutScheme.includes("@")
    ? withoutScheme.split("@").pop()
    : withoutScheme;
  const hostPart = afterAt.split("/")[0].split("?")[0];
  return { host: hostPart.split(":")[0], port: hostPart.split(":")[1], srv };
}

const { host, port, srv } = parseHost(uri);
console.log(`Scheme: ${srv ? "mongodb+srv" : "mongodb"}  Host: ${host}${port ? ":" + port : ""}`);

try {
  const records = srv
    ? await dns.resolveSrv(`_mongodb._tcp.${host}`)
    : await dns.resolve(host);
  console.log("Host resolves. DNS records found:", records.length);
} catch (err) {
  console.error(`Host DNS lookup FAILED for "${host}": ${err.code || err.message}`);
  console.error(
    "The hostname is wrong, or the cluster was deleted/paused. Re-copy the string from Atlas."
  );
  process.exit(1);
}

let client;
try {
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, family: 4 });
  client.on("error", () => {});
  await client.connect();
  await client.db(process.env.MONGODB_DB || "simmer").command({ ping: 1 });
  const count = await client
    .db(process.env.MONGODB_DB || "simmer")
    .collection("recipes")
    .countDocuments();
  console.log("MongoDB Atlas connection OK. Recipes stored:", count);
} catch (err) {
  const msg = err.message || "";
  const tls = /SSL alert number 80|tlsv1 alert internal error|SSL routines/i.test(msg);
  if (tls) {
    let ip = "";
    try {
      ip = (await (await fetch("https://api.ipify.org")).text()).trim();
    } catch {
      /* ignore */
    }
    console.error("MongoDB TLS handshake was REJECTED (this is Atlas refusing your IP).");
    if (ip) console.error(`Your current public IP: ${ip}`);
    console.error(
      "Fix: Atlas → Security → Network Access → Add IP Address → add this IP"
    );
    console.error(
      "     (or add 0.0.0.0/0 for a quick demo). Your ISP may change the IP, so re-add it if it breaks again."
    );
  } else {
    console.error("MongoDB connection FAILED:", msg);
    console.error(
      "Check: username/password in the URI, that you added your IP under Network Access, and that the cluster is not paused."
    );
  }
  process.exit(1);
} finally {
  if (client) await client.close().catch(() => {});
}
