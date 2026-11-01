import fs from "fs";
import path from "path";

import { packHap, unpackHap } from "../hap/index.js";
import { writeZip, readZip } from "../zip/index.js";
import { stringifyConfigMinified } from "../config/profile.js";
import { collect, sortEntries } from "./generateReleaseJsBin.js";
import { todo } from "./_util.js";

/**
 * packageReleaseHap —— 出 hap（release 变体要出两种形态）
 *
 * 依据（反编译 SingleLiteOptionsBuilder.executePack + AppVariantEvaluator.evaluateIsNeedPack）：
 *   if (isLiteWearable) {
 *       先跑 binBuilder 出 .bin 形态              ← 一定走
 *       if (isNeedPackage()) 再跑 jsBundleBuilder 出文件树形态
 *   }
 *   isNeedPackage = (buildType.name == selectedBuildType.name)，默认选中 RELEASE
 *
 * 实测两种产物的区别（devdemo release，同一份源码）：
 *
 *   entry-bin-release-lite-unsigned.hap   2293964 B
 *     └─ 只有一个条目：entry-release-unsigned.bin（2293792 B），stored 不压缩
 *
 *   entry-release-lite-unsigned.hap       2304041 B
 *     └─ 92 个条目，全部 stored（method=0），无目录条目
 *        条目名就是 source/lite 下的相对路径
 *        但 config.json 是 1935 B 的**紧凑单行版**，不是 source/lite 里那个 3422 B 的缩进版
 *
 * 这两种 hap 谁会进 .app：PackageApp.getHapPathFiles() 会过滤掉「文件名含 -bin- 且
 * deviceType 含 liteWearable」的，所以 .bin 形态进不了 .app，只有文件树形态进得去。
 */

export const name = "packageReleaseHap";
export const produces = "hap/release/entry-bin-release-lite-unsigned.hap + entry-release-lite-unsigned.hap";

export function run(ctx) {
  if (!ctx.paths.unsignedBin && !ctx.paths.signedBin) todo(name, "缺少 .bin，必须先跑 generateReleaseJsBin");

  const binPath = ctx.paths.signedBin ?? ctx.paths.unsignedBin;
  const outDir = path.join(ctx.work, "hap", "release");
  fs.mkdirSync(outDir, { recursive: true });

  // ── 形态一：单 .bin ────────────────────────────────────────────────
  const binHap = path.join(outDir, "entry-bin-release-lite-unsigned.hap");
  fs.writeFileSync(binHap, packHap(fs.readFileSync(binPath), path.basename(binPath)));
  ctx.paths.hap = binHap;

  // ── 形态二：文件树 ────────────────────────────────────────────────
  // isNeedPackage() 在 release 下为 true；调用方可以传 ctx.needPackage = false 显式关掉
  if (ctx.needPackage !== false) {
    if (!ctx.paths.binSource) todo(name, "缺少 binSource 目录，必须先跑 generateReleaseBinSource");
    if (!ctx.config) todo(name, "缺少 ctx.config");

    const treeHap = path.join(outDir, "entry-release-lite-unsigned.hap");
    fs.writeFileSync(treeHap, packTreeHap(ctx.paths.binSource, ctx.config));
    ctx.paths.treeHap = treeHap;
  }

  return outDir;
}

/**
 * 把 source/lite 整个目录打成 hap
 *
 * 唯一的加工点：config.json 换成紧凑单行版。里面其它 91 个文件原样塞进去。
 */
function packTreeHap(sourceRoot, config) {
  const entries = sortEntries(collect(sourceRoot)).map((e) => {
    const full = ((e.relPath || "").replace(/^\//, "") + "/" + e.fileName).replace(/^\//, "");

    let content = e.content;
    // config.json 在 hap 里是紧凑格式（实测 1935 B vs 缩进版 3422 B）
    if (full === "config.json") {
      content = Buffer.from(stringifyConfigMinified(config));
    } else if (/^assets\/js\/[^/]+\/manifest\.json$/.test(full)) {
      // manifest.json 在 hap 里同样是紧凑格式（实测 1051 B vs 缩进版 1316 B）
      content = Buffer.from(stringifyConfigMinified(JSON.parse(e.content.toString("utf8"))));
    }

    return { name: full, content };
  });

  // 全部 stored，不压缩（实测 Gradle 产物 92 个条目 method 全是 0）
  return writeZip(entries, { compress: false });
}

export function verify(ctx) {
  if (!ctx.paths.treeHap) return { ok: false, detail: "没有产出文件树形态" };

  const theirs = path.join(ctx.sample, "build", "outputs", "hap", "release", "entry-release-lite-unsigned.hap");
  if (!fs.existsSync(theirs)) return { ok: false, detail: `没有对照产物：${theirs}` };

  const want = readZip(fs.readFileSync(theirs));
  const mine = readZip(fs.readFileSync(ctx.paths.treeHap));

  const wm = new Map(want.map((e) => [e.name, e.content]));
  const mm = new Map(mine.map((e) => [e.name, e.content]));

  const missing = [...wm.keys()].filter((k) => !mm.has(k));
  const extra = [...mm.keys()].filter((k) => !wm.has(k));
  if (missing.length) return { ok: false, detail: `少了 ${missing.length} 个条目：${missing.slice(0, 5).join(", ")}` };
  if (extra.length) return { ok: false, detail: `多了 ${extra.length} 个条目：${extra.slice(0, 5).join(", ")}` };

  const diff = [...wm.keys()].filter((k) => !wm.get(k).equals(mm.get(k)));
  if (diff.length) {
    const sizes = diff.slice(0, 3).map((k) => `${k} ${mm.get(k).length} vs ${wm.get(k).length}`);
    return { ok: false, detail: `${diff.length} 个条目内容不同：${sizes.join("；")}` };
  }

  return { ok: true, detail: `${mine.length} 个条目内容全部一致` };
}
