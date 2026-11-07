import { writeZip } from "./readWriteZip.js";
import { stringifyConfigMinified } from "./processConfig.js";
import { collectFiles, entryPath } from "./collectFiles.js";

/**
 * 打 hap —— release 变体要出两种形态
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
 *        条目名就是 source 下的相对路径
 *        但 config.json 是 1935 B 的**紧凑单行版**，不是 source 里那个 3422 B 的缩进版
 *
 * 上面这些名字是 Gradle 的叫法（模块名 + 变体 + 设备形态）。本 SDK 自定义的部分只有
 * 两处：`.bin` 形态 hap 里那个条目叫 `<bundleName>-<moduleName>[-signed].bin`，`.app`
 * 里那份 hap 叫 `<bundleName>-<moduleName>.hap`。条目内容与下面描述的一致，没动。
 *
 * 这两种 hap 谁会进 .app：PackageApp.getHapPathFiles() 会过滤掉「文件名含 -bin- 且
 * deviceType 含 liteWearable」的，所以 .bin 形态进不了 .app，只有文件树形态进得去。
 */

/**
 * 形态一：把一个 .bin 装进 hap
 *
 * 实测依据（apps/_empty/_empty 与 apps/_inactive/stock）：
 *   hap 是标准 zip，里面只放一个 .bin，且用 stored（不压缩）。
 *
 * @param {Buffer} binBuf       .bin 内容
 * @param {string} binFileName  放进 zip 里的文件名，例如 com.example.app-entry-signed.bin
 * @returns {Buffer} hap
 */
export function packBinHap(binBuf, binFileName) {
  if (!binFileName) throw new Error("the file name of the .bin inside the hap is required");
  return writeZip([{ name: binFileName, content: binBuf }], { compress: false });
}

/**
 * 形态二：把 source 整个目录打成 hap
 *
 * 唯一的加工点：config.json 和每个组件的 manifest.json 换成紧凑单行版，
 * 里面其它文件原样塞进去（实测全部 stored，92 个条目 method 全是 0）。
 *
 * @param {string} sourceRoot  work/source
 * @param {object} config      最终版 config（已回填资源 id）
 * @returns {Buffer} hap
 */
export function packTreeHap(sourceRoot, config) {
  const entries = collectFiles(sourceRoot).map((e) => {
    const full = entryPath(e);

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

  return writeZip(entries, { compress: false });
}
