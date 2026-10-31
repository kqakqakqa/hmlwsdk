import fs from "fs";
import path from "path";

import { todo, deepEqual } from "./_util.js";

/**
 * mergeDebugResources —— 生成资源目录清单
 *
 * 不复制资源，只把「去哪找资源」的绝对路径写进一个索引文件。
 * 这个索引正是 restool 的 -b 参数值的来源。
 *
 * 实测格式（E:\\repo\\hmlw\\apps\\_empty\\_empty\\entry\\build\\intermediates\\merge_res\\debug\\merge_res_file.index，50 B）：
 *
 *   hex: 22 45 3a 5c ... 6d 61 69 6e 22 0d 0a
 *         "  E  :  \  ...  m  a  i  n  "  \r \n
 *
 * 也就是说路径被双引号包起来，行尾是 CRLF。
 * 50 = 1（引号）+ 46（路径）+ 1（引号）+ 2（CRLF）
 */

export const name = "mergeDebugResources";
export const produces = "merge_res/<variant>/merge_res_file.index";

export function run(ctx) {
  const mainDir = path.join(ctx.moduleDir, "src", "main");
  if (!fs.existsSync(mainDir)) todo(name, `${mainDir} 不存在，没法生成资源清单`);

  const out = path.join(ctx.work, "merge_res", ctx.variant, "merge_res_file.index");
  fs.mkdirSync(path.dirname(out), { recursive: true });

  // TODO 有 HAR 依赖时要逐个追加每个 HAR 的资源目录，这部分没实现也没样本可对照
  fs.writeFileSync(out, `"${mainDir}"\r\n`);

  ctx.paths.mergeResources = out;
  ctx.variantsDir = mainDir; // 后面 restool 的 -b 参数直接用这个
  return out;
}

export function verify(ctx) {
  const theirs = path.join(ctx.sample, "build", "intermediates", "merge_res", ctx.variant, "merge_res_file.index");
  if (!fs.existsSync(theirs)) return { ok: false, detail: `没有对照产物：${theirs}` };

  const mine = fs.readFileSync(ctx.paths.mergeResources);
  const want = fs.readFileSync(theirs);
  if (mine.length !== want.length) {
    return { ok: false, detail: `字节数不同：${mine.length} vs ${want.length}` };
  }
  if (mine.toString("utf8") !== want.toString("utf8")) {
    return { ok: false, detail: "内容不同（注意路径必须用反斜杠、带引号、CRLF 结尾）" };
  }
  return { ok: true, detail: `${mine.length} B 字节一致` };
}
