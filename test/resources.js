import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

import { compileResources, resolveTools } from "../src/index.js";
import { mergeProfile, stringifyConfig } from "../src/config/profile.js";
import { parseRTable } from "../src/resources/rtable.js";

const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");

const entry = "E:\\repo\\hmlw\\apps\\_empty\\_empty\\entry";
const srcConfig = JSON.parse(fs.readFileSync(`${entry}\\src\\main\\config.json`, "utf8"));
const gradleRes = `${entry}\\build\\intermediates\\res\\debug\\normal\\lite`;

const tools = resolveTools();
console.log("SDK       ", tools.root);

// 1. 先做 config 加工
const merged = mergeProfile(srcConfig, {
  compileSdkVersion: 6,
  compatibleSdkVersion: 3,
  debug: true
});

const work = fs.mkdtempSync(path.join(os.tmpdir(), "hmlwsdk-res-"));
const configPath = path.join(work, "config.json");
fs.writeFileSync(configPath, stringifyConfig(merged));

// 2. 编译资源
const t0 = Date.now();
const r = compileResources({
  tools,
  resourcesDir: `${entry}\\src\\main\\resources`,
  variantsDir: `${entry}\\src\\main`,
  configPath,
  bundleName: srcConfig.app.bundleName,
  moduleName: "entry",
  outDir: path.join(work, "res"),
  force: true
});
const ms = Date.now() - t0;

console.log("restool   ", r.ok ? "成功" : "失败", `(${ms} ms)`);
if (!r.ok) {
  console.log(r.stdout);
  console.log(r.stderr);
  process.exit(1);
}

// 3. 对比 gradle 产物
const cmp = (name, mine, theirs) => {
  if (!fs.existsSync(mine) || !fs.existsSync(theirs)) {
    console.log(`  ${name.padEnd(18)} 缺文件`);
    return false;
  }
  const a = sha(mine);
  const b = sha(theirs);
  const same = a === b;
  console.log(`  ${name.padEnd(18)} ${same ? "字节一致 ✓" : "不同"}`);
  if (!same) {
    const ba = fs.readFileSync(mine);
    const bb = fs.readFileSync(theirs);
    console.log(`  ${"".padEnd(18)} 大小 ${ba.length} vs ${bb.length}`);
    let diff = 0;
    let first = -1;
    for (let i = 0; i < Math.min(ba.length, bb.length); i++) {
      if (ba[i] !== bb[i]) {
        diff++;
        if (first < 0) first = i;
      }
    }
    console.log(`  ${"".padEnd(18)} 不同字节 ${diff}，首个偏移 ${first}`);
    if (first >= 0) {
      const ctx = (buf) => buf.subarray(Math.max(0, first - 4), first + 8).toString("latin1").replace(/[^\x20-\x7e]/g, ".");
      console.log(`  ${"".padEnd(18)} 我的   ${ctx(ba)}`);
      console.log(`  ${"".padEnd(18)} gradle ${ctx(bb)}`);
    }
  }
  return same;
};

console.log("产物对比：");
cmp("R.txt", r.rTxtFile, `${gradleRes}\\R.txt`);
cmp("resources.index", r.indexFile, `${gradleRes}\\resources.index`);

// 4. R.txt 解析出来的资源编号要能对上 config
const rtable = parseRTable(fs.readFileSync(r.rTxtFile, "utf8"));
console.log("资源编号  ", JSON.stringify(rtable));

console.log("临时目录  ", work);
