import fs from "fs";
import crypto from "crypto";

import { readZip, writeZip } from "../src/zip/index.js";
import { unpackHap, packHap, hapForm } from "../src/hap/index.js";

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

const samples = process.argv.slice(2);
if (samples.length === 0) {
  console.error("usage: node test/hap.js <file.hap> [...]");
  process.exit(1);
}

let pass = 0;
let fail = 0;

for (const p of samples) {
  if (!fs.existsSync(p)) {
    console.log(`SKIP  ${p}`);
    continue;
  }

  console.log("─".repeat(72));
  console.log(`文件      ${p.split("\\").slice(-1)[0]}`);
  const buf = fs.readFileSync(p);
  const form = hapForm(buf);
  console.log(`大小      ${buf.length} B`);
  console.log(`形态      ${form === "bin" ? "bin（zip 内单个 .bin）" : "tree（zip 内文件树）"}`);

  // 1. 用自己的 reader 读
  const entries = readZip(buf);
  console.log(`条目      ${entries.length}`);

  if (form === "bin") {
    const { binFileName, binBuf } = unpackHap(buf);
    console.log(`内层      ${binFileName}  ${binBuf.length} B`);

    // 2. 重新打包
    const repacked = packHap(binBuf, binFileName);
    console.log(`重打包    ${repacked.length} B`);
    console.log(`原始 sha  ${sha256(buf)}`);
    console.log(`重打 sha  ${sha256(repacked)}`);

    // 3. 验证重打包后还能读回来且内容一致
    const again = unpackHap(repacked);
    if (sha256(again.binBuf) === sha256(binBuf)) {
      console.log("往返      .bin 内容一致 ✓");
      pass++;
    } else {
      console.log("往返      .bin 内容不一致 ✗");
      fail++;
    }

    if (sha256(repacked) === sha256(buf)) {
      console.log("字节      与原 hap 完全一致 ✓");
    } else {
      console.log("字节      与原 hap 不同（zip 元数据差异，内容等价）");
    }
  } else {
    // tree 形态：读出来再打回去，比对每个条目内容
    const rebuilt = writeZip(entries.map((e) => ({ name: e.name, content: e.content })), { compress: false });
    const back = readZip(rebuilt);
    const same =
      back.length === entries.length &&
      back.every((e, i) => e.name === entries[i].name && sha256(e.content) === sha256(entries[i].content));
    console.log(`重打包    ${rebuilt.length} B`);
    console.log(`往返      ${same ? `${back.length} 个条目内容全部一致 ✓` : "有差异 ✗"}`);
    if (same) pass++;
    else fail++;

    console.log("前几个条目：");
    for (const e of entries.slice(0, 8)) console.log(`  ${e.name}  ${e.size} B  method=${e.method}`);
    if (entries.length > 8) console.log(`  … 还有 ${entries.length - 8} 个`);
  }
}

console.log("─".repeat(72));
console.log(`通过 ${pass}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
