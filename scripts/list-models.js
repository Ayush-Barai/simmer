import "dotenv/config";
import { listModels } from "../server/gemma.js";

try {
  const models = await listModels();
  const gemma = models.filter((m) => m.id.startsWith("gemma"));
  console.log("Gemma models available to your key:\n");
  for (const m of gemma) {
    console.log(`  ${m.generate ? "[generateContent] " : "[no generate]    "}${m.id}`);
  }
  if (gemma.length === 0) {
    console.log("  (none) - check that your GEMMA_API_KEY is correct.");
  }
  console.log(
    "\nSet the one you want in .env as GEMMA_MODEL (recommended: gemma-4-26b-a4b-it)."
  );
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
