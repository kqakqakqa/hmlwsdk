import fs from "fs";
import path from "path";

import { packHap, unpackHap } from "../hap/index.js";
import { todo } from "./_util.js";

/**
 * packageDebugHap —— 把 .bin 打成 hap
 *
 * 实测依据（apps/_empty/_empty）：
 *   entry/build/outputs/bin/debug/entry-debug-unsigned.bin         110958 B
 *   → entry/build/outputs/hap/debug/entry-bin-debug-lite-unsigned.hap 111126 B
 *
 * hap 就是标准 zip，里面只放一个 .bin，而且用 stored 不压缩。
 *
 * 两种形态的判定（反编译 PackageHap → SingleLiteOptionsBuilder.executePack()）：
 *   if (isLiteWearable) {
 *       跑 binBuilder 出 .bin 形态              ← liteWearable 一定会走这支
 *       if (isNeedPackage()) 再跑 jsBundleBuilder 出文件树形态
 *   } else { 只跑 jsBundleBuilder }
 *
 * isNeedPackage 的来源：AppVariantEvaluator.evaluateIsNeedPack 第一步就是
 * buildType.name != selectedBuildType.name 直接返回 false，而 selectedBuildType
 * 默认取名字为 RELEASE 的那个。所以：
 *   debug   → false，只出 .bin 形态
 *   release → true，两种形态都出
 */

export const name = "packageDebugHap";
export const produces = "hap/<variant>/entry-bin-<variant>-lite-unsigned.hap";

export function run(ctx) {
  if (!ctx.paths.unsignedBin && !ctx.paths.signedBin) todo(name, "缺少 .bin，必须先跑 generateJsBin");

  const binPath = ctx.paths.signedBin ?? ctx.paths.unsignedBin;
  const binFileName = path.basename(binPath);

  const outDir = path.join(ctx.work, "hap", ctx.variant);
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `entry-bin-${ctx.variant}-lite-unsigned.hap`);

  fs.writeFileSync(out, packHap(fs.readFileSync(binPath), binFileName));

  ctx.paths.hap = out;

  // release 变体还要出文件树形态（isNeedPackage = true）
  if (ctx.variant === "release" && ctx.needPackage !== false) {
    todo(
      name,
      "release 变体还要再出一份文件树形态的 hap（jsBundleBuilder）。" +
        ".bin 形态已经生成，文件树形态没写：那一步要按 isNeedPackage() 分支再打一次 zip"
    );
  }

  return out;
}

export function verify(ctx) {
  const theirs = path.join(ctx.sample, "build", "outputs", "hap", ctx.variant, `entry-bin-${ctx.variant}-lite-unsigned.hap`);
  if (!fs.existsSync(theirs)) return { ok: false, detail: `没有对照产物：${theirs}` };

  const a = unpackHap(fs.readFileSync(theirs));
  const b = unpackHap(fs.readFileSync(ctx.paths.hap));

  if (!a.binBuf.equals(b.binBuf)) return { ok: false, detail: "包内 .bin 内容不同" };

  return {
    ok: true,
    detail: `包内 ${b.binFileName} ${b.binBuf.length} B 一致（整包字节可能因 zip 元数据不同）`
  };
}
