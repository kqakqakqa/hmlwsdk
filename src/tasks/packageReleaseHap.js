import fs from "fs";
import path from "path";

import { packHap, unpackHap } from "../hap/index.js";
import { todo } from "./_util.js";

/**
 * packageReleaseHap —— 把 .bin 打成 hap（release 变体）
 *
 * 与 debug 的关键差异：这个变体要出**两种**形态的 hap。
 *
 * 依据（反编译 SingleLiteOptionsBuilder.executePack + AppVariantEvaluator.evaluateIsNeedPack）：
 *   if (isLiteWearable) {
 *       先跑 binBuilder 出 .bin 形态              ← 一定走
 *       if (isNeedPackage()) 再跑 jsBundleBuilder 出文件树形态
 *   }
 *   isNeedPackage = (buildType.name == selectedBuildType.name)
 *   而 selectedBuildType 默认取名字为 RELEASE 的那个
 *
 * 所以 release 一次构建同时产出：
 *   entry-bin-release-lite-unsigned.hap     ← .bin 形态（本文件已实现）
 *   entry-release-lite-unsigned.hap         ← 文件树形态（TODO）
 *
 * 实测吻合：devdemo 一次 release 构建同时出这两个文件，时间戳相同：
 *   entry-bin-release-lite-unsigned.hap  2293964 B
 *   entry-release-lite-unsigned.hap      2304041 B（92 条目）
 */

export const name = "packageReleaseHap";
export const produces = "hap/release/entry-bin-release-lite-unsigned.hap + 文件树形态";

export function run(ctx) {
  if (!ctx.paths.unsignedBin && !ctx.paths.signedBin) todo(name, "缺少 .bin，必须先跑 generateReleaseJsBin");

  const binPath = ctx.paths.signedBin ?? ctx.paths.unsignedBin;
  const binFileName = path.basename(binPath);

  const outDir = path.join(ctx.work, "hap", "release");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "entry-bin-release-lite-unsigned.hap");

  fs.writeFileSync(out, packHap(fs.readFileSync(binPath), binFileName));
  ctx.paths.hap = out;

  // 文件树形态：isNeedPackage() 在 release 下为 true
  if (ctx.needPackage !== false) {
    todo(
      name,
      `.bin 形态已生成（${path.basename(out)}），还要再出一份文件树形态的 hap：` +
        "把 source/lite 整个目录按 zip 打进去（92 条目级别），这一步没写"
    );
  }

  return out;
}

export function verify(ctx) {
  const theirs = path.join(ctx.sample, "build", "outputs", "hap", "release", "entry-bin-release-lite-unsigned.hap");
  if (!fs.existsSync(theirs)) return { ok: false, detail: `没有对照产物：${theirs}` };

  const a = unpackHap(fs.readFileSync(theirs));
  const b = unpackHap(fs.readFileSync(ctx.paths.hap));
  if (!a.binBuf.equals(b.binBuf)) return { ok: false, detail: "包内 .bin 内容不同" };
  return { ok: true, detail: `包内 ${b.binFileName} ${b.binBuf.length} B 一致` };
}
