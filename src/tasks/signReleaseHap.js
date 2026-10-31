import fs from "fs";
import path from "path";

import { todo } from "./_util.js";

/**
 * signReleaseHap —— 给 hap 签名，并汇总写 hapInfo.json
 *
 * Gradle 的动作：
 *   1. 按设备类型把 unsigned hap 分成 rich / lite 两组
 *   2. 逐个算出 signed 文件名（把 unsigned 替换成 signed）
 *   3. 配了证书就调 SignUtil → java -jar hapsigntoolv2.jar sign -mode binlocaljks
 *      -profile … -signAlg … -privatekey …
 *   4. signed 文件存在就用它，否则退回原包
 *   5. 按 packedMode 把 hap 复制到各设备目录
 *   6. 汇总写出 hapInfo.json
 *
 * 实测输出（apps/_empty/_empty/entry/build/outputs/hap/debug/hapInfo.json，104 B）：
 *   [{"hapPath":"entry-bin-debug-lite-unsigned.hap","device":"liteWearable"}]
 *
 * 注意 hapInfo.json 里写的还是 unsigned 文件名 —— 因为没配证书，没签。
 * devdemo 的 release 目录下没有 hapInfo.json，所以这条没有 release 对照物。
 */

export const name = "signReleaseHap";
export const produces = "hap/release/hapInfo.json";

export function run(ctx) {
  if (!ctx.paths.hap) todo(name, "缺少 hap，必须先跑 packageReleaseHap");

  const outDir = path.join(ctx.work, "hap", "release");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "hapInfo.json");

  // 没配证书：hap 保持 unsigned，只汇总 hapInfo.json（与 gradle 实测行为一致）
  if (!ctx.signingConfig) {
    const info = [{ hapPath: path.basename(ctx.paths.hap), device: "liteWearable" }];
    fs.writeFileSync(out, JSON.stringify(info));
    ctx.paths.hapInfo = out;
    ctx.paths.signedHap = ctx.paths.hap;
    return out;
  }

  todo(
    name,
    "已配证书：要调签名工具重签（-mode binlocaljks），再把 signed 包按 packedMode " +
      "复制到各设备目录，最后汇总 hapInfo.json"
  );
}

export function verify(ctx) {
  const theirs = path.join(ctx.sample, "build", "outputs", "hap", "release", "hapInfo.json");
  if (!fs.existsSync(theirs)) return { ok: false, detail: `没有对照产物：${theirs}（devdemo 的 release 没留这个文件）` };

  const mine = fs.readFileSync(ctx.paths.hapInfo, "utf8");
  const want = fs.readFileSync(theirs, "utf8");
  const same = mine === want;
  return { ok: same, detail: same ? `${want.length} B 字节一致` : `内容不同：我 ${mine}，gradle ${want}` };
}
