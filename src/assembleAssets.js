import fs from "fs";
import path from "path";

import { stringifyConfig } from "./processConfig.js";
import { parseRTable, fillResourceIds } from "./parseResourceTable.js";

/**
 * 收尾组装 —— 把 source 目录定型成 .bin 的原料树
 *
 * 到这一步时目录里已经有两批东西，本文件不搬运它们，只做定型和清理：
 *   source/assets/entry/**   compileResources 直接写在这（resources.index + resources/）
 *                            webpack 阶段的 img2bin 又往 resources/base/media 补了 icon.bin
 *   source/assets/js/**      compileJs 直接写在这
 *
 * 实测产物（apps/devdemo/devdemo release，共 92 个文件）：
 *   source/config.json                              3422 B  ← 本文件写
 *   source/assets/entry/resources.index              338 B
 *   source/assets/entry/resources/base/media/*.key   1 B
 *   source/assets/entry/resources/base/media/icon.bin      51992 B
 *   source/assets/entry/resources/base/media/icon.png      3621 B
 *   source/assets/entry/resources/rawfile/*                ← 资源编译
 *   source/assets/js/default/app.js / app.bc / manifest.json
 *   source/assets/js/default/common/*.bin + *.png
 *
 * 注意 .png 和 .bin 并存 —— 复制 assets 时只排除 .txt 后缀，没排除 .png。
 * 而 .bin 那批不是资源编译的产物，是 ace-loader 的 ImageCoverterPlugin
 * 在 webpack 阶段顺手做的（webpack.lite.config.js 第 185 行）。
 */

/**
 * @param {object} opts
 * @param {string} opts.sourceRoot  work/source，产物树根
 * @param {object} opts.config      加工过的 config（会回填 iconId / labelId）
 * @param {string} opts.rTxtText    R.txt 的内容，回填资源 id 用
 * @returns {object} 最终写进包的 config
 */
export function assembleAssets(opts) {
  const { sourceRoot } = opts;

  fs.mkdirSync(sourceRoot, { recursive: true });

  // ── config.json ─────────────────────────────────────────────────────
  // 两处改动才能从加工阶段的东西变成最终打进包的版本：
  //   1. abilities 里回填 iconId / labelId（从 R.txt 查出来）
  //   2. deviceType 清空后只写回 LITE_WEARABLE
  const rtable = parseRTable(opts.rTxtText);
  const config = fillResourceIds(structuredClone(opts.config), rtable);

  if (config.module) {
    config.module.deviceType = ["liteWearable"];
  }

  fs.writeFileSync(path.join(sourceRoot, "config.json"), stringifyConfig(config));

  // 兜底：sourceRoot 根下只允许有 assets/ 和 config.json。
  // 早期的错误实现会把 webpack 产物写到根下（/app.js、/common/、/_releaseMap/ …），
  // 换到正确 buildDir 后这些老文件会残留，被打进 .bin 里变成多余条目。
  for (const ent of fs.readdirSync(sourceRoot)) {
    if (ent === "assets" || ent === "config.json") continue;
    fs.rmSync(path.join(sourceRoot, ent), { recursive: true, force: true });
  }

  // 清掉双后缀 .png.bin
  // ace-loader 的 lite-image2bin.js 会同时写两份：xxx.bin 和 xxx.png.bin。
  // Gradle 的 92 个产物条目里一个 .png.bin 都没有，只留单后缀那份。
  removeDoubleSuffixBin(sourceRoot);

  return config;
}

/**
 * 删掉形如 icon.png.bin 的双后缀文件
 * 依据 ace-loader/lib/lite/lite-image2bin.js：
 *   f = t.replace(/\.(png|jpg|jpeg|bmp)$/i, ".bin")   // 单后缀
 *   h = t + ".bin"                                     // 双后缀
 *   两个都 writeFileSync
 */
function removeDoubleSuffixBin(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) removeDoubleSuffixBin(p);
    else if (/\.(png|jpg|jpeg|bmp)\.bin$/i.test(ent.name)) fs.rmSync(p, { force: true });
  }
}
