import fs from "fs";
import path from "path";

import { todo } from "./_util.js";

/**
 * mergeReleaseResources —— 生成资源目录清单
 *
 * 不复制资源，只把「去哪找资源」的绝对路径写进一个索引文件。
 * 这个索引正是 restool 的 -b 参数值的来源。
 *
 * 实测格式（apps/_empty/_empty/entry/build/intermediates/merge_res/debug/merge_res_file.index，50 B）：
 *
 *   hex: 22 45 3a 5c ... 6d 61 69 6e 22 0d 0a
 *         "  E  :  \  ...  m  a  i  n  "  \r \n
 *
 * 也就是说路径被双引号包起来，行尾是 CRLF。
 * 50 = 1（引号）+ 46（路径）+ 1（引号）+ 2（CRLF）
 *
 * 变体无关：release 与 debug 产出的格式完全一样，只有目录名不同。
 */

export const name = "mergeReleaseResources";
export const produces = "merge_res/release/merge_res_file.index";

export function run(ctx) {
  const mainDir = path.join(ctx.moduleDir, "src", "main");
  if (!fs.existsSync(mainDir)) todo(name, `${mainDir} 不存在，没法生成资源清单`);

  const out = path.join(ctx.work, "merge_res", "release", "merge_res_file.index");
  fs.mkdirSync(path.dirname(out), { recursive: true });

  // TODO 有 HAR 依赖时要逐个追加每个 HAR 的资源目录，这部分没实现也没样本可对照
  fs.writeFileSync(out, `"${mainDir}"\r\n`);

  ctx.paths.mergeResources = out;
  ctx.variantsDir = mainDir; // 后面 restool 的 -b 参数直接用这个
  return out;
}
