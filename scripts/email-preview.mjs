// Podgląd maili bez serwera: node scripts/email-preview.mjs
// Zapisuje galerię i każdy mail do .wrangler/email-preview/ (grafiki z lokalnego public/).
// Z serwerem to samo jest pod http://localhost:8790/api/dev/maile.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { galleryHtml, sampleEmails } from "../src/email-samples.js";

const out = resolve(".wrangler/email-preview");
mkdirSync(out, { recursive: true });
const origin = pathToFileURL(resolve("public")).href;
const samples = sampleEmails(origin);
for (const { id, mail } of samples) {
  writeFileSync(`${out}/${id}.html`, mail.html);
  writeFileSync(`${out}/${id}.txt`, `Temat: ${mail.subject}\n\n${mail.text}\n`);
}
writeFileSync(`${out}/index.html`, galleryHtml(samples, (id) => `${id}.html`, origin));
console.log(`${out}/index.html`);
