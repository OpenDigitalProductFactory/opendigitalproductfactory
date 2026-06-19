// One-off: score the business-facing sections of the hand-authored landing page.
import { readFileSync } from "node:fs";
import { analyze, band } from "./_readability.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const section = (id) => (html.match(new RegExp(`<section id="${id}"[\\s\\S]*?</section>`)) || [""])[0];
const lede = (html.match(/<p class="lede">([\s\S]*?)<\/p>/) || ["", ""])[1];
const callout = (html.match(/The bigger picture[\s\S]*?<\/p>\s*<\/div>/) || [""])[0];

const blocks = {
  "hero lede": lede,
  "core message": callout,
  "#audience (who)": section("audience"),
  "#find-your-business": section("find-your-business"),
  "#mobile": section("mobile"),
};
for (const [k, v] of Object.entries(blocks)) {
  const a = analyze(v);
  console.log(k.padEnd(22), "Grade", String(a.gradeLevel).padStart(4), "ease", String(a.readingEase).padStart(5), " ", band(a.gradeLevel));
}
