// Grafiki do maili: PNG (Gmail i Outlook nie pokazują SVG ani WebP), w 2x rozmiaru wyświetlania.
// Źródła: logo z public/brand/ i ilustracje z design/zrodla/. Uruchomienie: node scripts/mail-assets.mjs
import sharp from "sharp";

const out = "public/mail";
await sharp("public/brand/logo-dark.svg", { density: 300 }).resize({ width: 300 }).png({ palette: true }).toFile(`${out}/logo-dark.png`);
for (const name of ["kod-mail", "gotowe-link", "dzieki-wiadomosc", "statystyki"]) {
  await sharp(`design/zrodla/${name}.png`).resize({ width: 400 }).png({ palette: true, quality: 90 }).toFile(`${out}/${name}.png`);
}
console.log("gotowe");
