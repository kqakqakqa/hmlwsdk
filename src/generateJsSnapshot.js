import fs from "fs";
import path from "path";

import { snapshotJs } from "./jerry-parser-wasm/snapshotJs.js";

/**
 * 把一个目录下所有 .js 编成同名 .bc（真机 JRRY v24 字节码）
 *
 * 为什么由本 SDK 自己干，而不是让 ace-loader 的 SnapshotPlugin 干：
 *   那个 plugin 的实现是 exec('"<ace-loader>/bin/jerry-snapshot.exe" generate -o ...')，
 *   exe 只有 Windows 版、属于 HarmonyOS SDK。这里换成 jerry-parser-wasm 在进程内生成，
 *   产物与那个 exe 逐字节一致（devdemo 22 个真实 bundle 实测）。
 *   ace-loader 侧的 SnapshotPlugin 已经用 --isPreview=true 关掉了，见 src/runWebpack.js。
 *
 * 覆盖范围跟 SnapshotPlugin 对齐：它遍历 webpack assets 里所有 .js 生成 .bc，
 * 这里遍历构建目录下所有 .js —— webpack 的 assets 都会落盘，两者等价。
 *
 * 每个文件都要新建 wasm 实例：同一实例连续 callMain 会让 jerry 内部堆不清零，
 * 后续快照的字面量表字节会漂移（实测 22 个文件只有前 2 个正确）。细节见
 * src/jerry-parser-wasm/snapshotJs.js 的文件头注释。
 */

const IS_JS = /\.js$/i;

function collectJsFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsFiles(abs, found);
    else if (IS_JS.test(entry.name)) found.push(abs);
  }
  return found;
}

/**
 * @param {string} dir 构建产物目录（webpack 的 buildDir）
 * @returns {Promise<{count:number, totalBytes:number, files:string[]}>}
 */
export async function generateJsSnapshot(dir) {
  // 排序只为输出稳定，跟产物内容无关
  const files = collectJsFiles(dir).sort();

  let totalBytes = 0;
  for (const file of files) {
    // snapshotJs 内部已经做过 JRRY v24 校验，拿到的一定是设备认的快照
    const bc = await snapshotJs(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file.replace(IS_JS, ".bc"), bc);
    totalBytes += bc.length;
  }

  return { count: files.length, totalBytes, files };
}
