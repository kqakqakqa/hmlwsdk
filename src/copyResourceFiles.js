import fs from "fs";
import path from "path";

import { compressPng } from "./compressPng.js";

/**
 * 把 media / profile / rawfile 这些"文件型资源"落到输出目录
 *
 * restool 输出目录的形状（实测 apps/devdemo devdemo release 产物）：
 *
 *   resources/
 *     base/
 *       media/
 *         attributes.key  constants.key  contents.key  nodes.key   ← 各 1 字节，内容就是一个 0
 *         icon.png  icon_small.png
 *       profile/
 *         xxx.json                                                    ← 原样复制
 *     rawfile/                                                        ← 整棵原样复制
 *       fileReadTest.txt
 *
 * 注意 element 目录**不**在输出里 —— 那些资源只进 resources.index，没有对应文件。
 *
 * 那 4 个 .key 是 api6 的 restool 特有产物，每个有 media 的限定目录下都会生成一份，
 * 内容是单字节 0。设备端拿它们当空的 layout 属性表用，liteWearable 用不上但产物里必须有
 * （Gradle 打出来的 .bin 里这 4 个文件都在）。
 *
 * 图片压缩见 compressPng.js：restool 加 -z 时会把 png 重写一遍（丢辅助 chunk + 重压），
 * 不加 -z 是纯字节复制。compressImage 为 false 时这里也走纯复制。
 */

/** api6 restool 会在每个 media 目录下写这 4 个空表文件 */
const MEDIA_KEY_FILES = ["attributes.key", "constants.key", "contents.key", "nodes.key"];

/**
 * @param {object} opts
 * @param {string} opts.outDir 输出目录（outputs 里 resources.index 所在的那一层）
 * @param {Array} opts.configs scanResourceFiles 的结果
 * @param {Array<{relPath:string, filePath:string}>} opts.copyOnly rawfile / resfile 的清单
 * @param {boolean} opts.compressImage 是否压缩图片（对应 restool 的 -z）
 * @returns {{copied:number, compressed:number, keptAsIs:number}}
 */
export function copyResourceFiles(opts) {
  const resourcesOut = path.join(opts.outDir, "resources");
  const stats = { copied: 0, compressed: 0, keptAsIs: 0 };

  for (const config of opts.configs) {
    for (const cluster of config.clusters) {
      if (cluster.cluster === "element") continue;

      const targetDir = path.join(resourcesOut, config.limitKey, cluster.cluster);
      for (const filePath of cluster.files) {
        fs.mkdirSync(targetDir, { recursive: true });
        const target = path.join(targetDir, path.basename(filePath));

        // 只有 media 下的 png 会被压缩，profile 一律原样复制
        if (cluster.cluster === "media" && opts.compressImage) {
          stats[copyMaybeCompressPng(filePath, target)]++;
        } else {
          fs.copyFileSync(filePath, target);
          stats.copied++;
        }
      }

      if (cluster.cluster === "media") {
        for (const keyFile of MEDIA_KEY_FILES) {
          fs.writeFileSync(path.join(targetDir, keyFile), Buffer.from([0]));
        }
      }
    }
  }

  for (const file of opts.copyOnly) {
    const target = path.join(resourcesOut, ...file.relPath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file.filePath, target);
    stats.copied++;
  }

  return stats;
}

/**
 * png 走重编码，其余格式（以及压缩不支持的 png 形态）原样复制
 * @returns {"compressed"|"keptAsIs"}
 */
function copyMaybeCompressPng(filePath, target) {
  const buf = fs.readFileSync(filePath);
  const compressed = path.extname(filePath).toLowerCase() === ".png" ? compressPng(buf) : null;
  if (compressed) {
    fs.writeFileSync(target, compressed);
    return "compressed";
  }
  fs.writeFileSync(target, buf);
  return "keptAsIs";
}
