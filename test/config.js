import fs from "fs";

import { mergeProfile, processProfile } from "../src/config/profile.js";
import { parseRTable, fillResourceIds } from "../src/resources/rtable.js";

const proj = "E:\\repo\\hmlw\\apps\\_empty\\_empty\\entry";

const srcPath = `${proj}\\src\\main\\config.json`;
const mergePath = `${proj}\\build\\intermediates\\merge_profile\\debug\\config.json`;
const processPath = `${proj}\\build\\intermediates\\process_profile\\debug\\normal\\config.json`;
const finalPath = `${proj}\\build\\intermediates\\js\\debug\\source\\lite\\config.json`;
const rtxtPath = `${proj}\\build\\intermediates\\res\\debug\\normal\\lite\\R.txt`;

const readJ = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

/** 深比较，忽略对象键顺序 */
function deepEqual(a, b, path = "") {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${path}: 类型不同 ${typeof a} vs ${typeof b}`;
  if (a === null || b === null) return `${path}: ${a} vs ${b}`;
  if (typeof a !== "object") return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;

  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();

  const onlyA = ka.filter((k) => !kb.includes(k));
  const onlyB = kb.filter((k) => !ka.includes(k));
  if (onlyA.length) return `${path}: 少了 ${onlyA.join(",")}`;
  if (onlyB.length) return `${path}: 多了 ${onlyB.join(",")}`;

  for (const k of ka) {
    const d = deepEqual(a[k], b[k], path ? `${path}.${k}` : k);
    if (d) return d;
  }
  return null;
}

console.log("═".repeat(72));

// ── 1. 源码 → mergeProfile
const src = readJ(srcPath);
const merged = mergeProfile(src, {
  compileSdkVersion: 6,
  compatibleSdkVersion: 3,
  debug: true
});

const expectedMerge = readJ(mergePath);
const d1 = deepEqual(merged, expectedMerge);
console.log(`mergeProfile      ${d1 ? "✗ " + d1 : "内容一致 ✓"}`);

// ── 2. processProfile
const processed = processProfile(merged);
const expectedProcess = readJ(processPath);
const d2 = deepEqual(processed, expectedProcess);
console.log(`processProfile    ${d2 ? "✗ " + d2 : "内容一致 ✓"}`);

// ── 3. 回填资源编号
const rtable = parseRTable(fs.readFileSync(rtxtPath, "utf8"));
console.log(`R.txt 解析        ${JSON.stringify(rtable)}`);

const filled = fillResourceIds(structuredClone(processed), rtable);
const expectedFinal = readJ(finalPath);
const d3 = deepEqual(filled, expectedFinal);
console.log(`fillResourceIds   ${d3 ? "✗ " + d3 : "内容一致 ✓"}`);

// ── 4. 逐阶段字节数对比
console.log("─".repeat(72));
const show = (label, p) => {
  const raw = fs.readFileSync(p);
  console.log(`${label.padEnd(34)} ${raw.length} B`);
};
show("源码 config.json", srcPath);
show("gradle merge_profile", mergePath);
show("gradle process_profile", processPath);
show("gradle 最终打进包", finalPath);

const mine = JSON.stringify(filled, null, 4);
console.log(`${"本 SDK 产出".padEnd(34)} ${Buffer.byteLength(mine)} B`);
console.log(`${"gradle 最终".padEnd(34)} ${fs.readFileSync(finalPath).length} B`);

console.log("─".repeat(72));
const ok = !d1 && !d2 && !d3;
console.log(ok ? "三个阶段的 JSON 内容全部一致 ✓" : "有阶段不一致 ✗");
console.log("（键顺序与 gradle 不同，属正常：gradle 用 Java HashMap，顺序不固定且无语义）");
process.exit(ok ? 0 : 1);
