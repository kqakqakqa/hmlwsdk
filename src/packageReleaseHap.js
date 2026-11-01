import fs from "fs";
import path from "path";

import { packHap } from "./packHap.js";
import { writeZip } from "./readWriteZip.js";
import { stringifyConfigMinified } from "./processConfig.js";
import { collect, sortEntries } from "./generateReleaseJsBin.js";
import { todo } from "./createTaskContext.js";

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

export function run(taskContext) {
  if (!taskContext.paths.unsignedBin && !taskContext.paths.signedBin) todo(name, "缺少 .bin，必须先跑 generateReleaseJsBin");

  const binPath = taskContext.paths.signedBin ?? taskContext.paths.unsignedBin;
  const outDir = path.join(taskContext.work, "hap", "release");
  fs.mkdirSync(outDir, { recursive: true });

  // ── 形态一：单 .bin ────────────────────────────────────────────────
  const binHap = path.join(outDir, "entry-bin-release-lite-unsigned.hap");
  fs.writeFileSync(binHap, packHap(fs.readFileSync(binPath), path.basename(binPath)));
  taskContext.paths.hap = binHap;

  // ── 形态二：文件树 ────────────────────────────────────────────────
  // isNeedPackage() 在 release 下为 true；调用方可以传 taskContext.needPackage = false 显式关掉
  if (taskContext.needPackage !== false) {
    if (!taskContext.paths.binSource) todo(name, "缺少 binSource 目录，必须先跑 generateReleaseBinSource");
    if (!taskContext.config) todo(name, "缺少 taskContext.config");

    const treeHap = path.join(outDir, "entry-release-lite-unsigned.hap");
    fs.writeFileSync(treeHap, packTreeHap(taskContext.paths.binSource, taskContext.config));
    taskContext.paths.treeHap = treeHap;
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
