import fs from "fs";
import crypto from "crypto";

import { readBin, writeBin } from "../src/bin/index.js";

const samples = process.argv.slice(2);

if (samples.length === 0) {
  console.error("usage: node test/roundtrip.js <file.bin> [...]");
  process.exit(1);
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

let pass = 0;
let fail = 0;

for (const p of samples) {
  if (!fs.existsSync(p)) {
    console.log(`SKIP  ${p}  (不存在)`);
    continue;
  }

  const original = fs.readFileSync(p);
  const model = readBin(original);
  const rebuilt = writeBin(model);

  const a = sha256(original);
  const b = sha256(rebuilt);

  console.log("─".repeat(72));
  console.log(`文件      ${p}`);
  console.log(`大小      ${original.length} → ${rebuilt.length}`);
  console.log(`bundle    ${model.bundleName}`);
  console.log(`条目数    ${model.entries.length}`);
  console.log(`magic     0x${model.magic.toString(16)}`);

  if (model.entries.length > 0) {
    console.log("前几个条目：");
    for (const e of model.entries.slice(0, 5)) {
      const full = e.relPath === "" ? e.fileName : `${e.relPath.replace(/^\//, "")}/${e.fileName}`;
      console.log(`  ${full}  (${e.content.length} B)`);
    }
    if (model.entries.length > 5) console.log(`  … 还有 ${model.entries.length - 5} 个`);
  }

  console.log(`原始  ${a}`);
  console.log(`重建  ${b}`);

  if (a === b) {
    console.log("结果  一致 ✓");
    pass++;
  } else {
    console.log("结果  不一致 ✗");
    // 找到第一个不同的字节，帮助定位格式偏差
    const n = Math.min(original.length, rebuilt.length);
    for (let i = 0; i < n; i++) {
      if (original[i] !== rebuilt[i]) {
        console.log(`首个差异在偏移 ${i}: 原始 0x${original[i].toString(16)} 重建 0x${rebuilt[i].toString(16)}`);
        const from = Math.max(0, i - 8);
        console.log(`原始  ${original.subarray(from, i + 8).toString("hex")}`);
        console.log(`重建  ${rebuilt.subarray(from, i + 8).toString("hex")}`);
        break;
      }
    }
    fail++;
  }
}

console.log("─".repeat(72));
console.log(`通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
