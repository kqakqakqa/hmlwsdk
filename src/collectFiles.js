import fs from "fs";
import path from "path";

/**
 * 递归扫一个目录，收集成 .bin / zip 的条目列表
 *
 * 返回的每项 { fileName, relPath, content }：
 *   fileName  文件名，例如 app.js
 *   relPath   相对根的目录，带前导斜杠，例如 /assets/js/default；根下的文件是 ""
 *   content   Buffer
 *
 * 顺序按「先路径深度、再字节序」，与 Gradle 的产物一致。
 */
export function collectFiles(dir, root = dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      collectFiles(full, root, acc);
      continue;
    }
    const rel = path.relative(root, dir).replace(/\\/g, "/");
    acc.push({
      fileName: ent.name,
      relPath: rel === "" ? "" : "/" + rel,
      content: fs.readFileSync(full)
    });
  }
  return sortByDepthThenName(acc);
}

/**
 * 按路径深度、再按字节序排
 *
 * 第二级**必须用字节序**（`pa < pb`），不能用 localeCompare —— 后者把
 * `icon.bin` 排到 `icon_small.bin` 后面（`.` 在 locale 里被当作可忽略标点，
 * `_` 不是）。实测拿 _empty 的 15 个条目对照 Gradle 的 entry-debug-unsigned.bin：
 * 用 localeCompare 时 icon / icon_small 那四个位置不对，换成字节序后逐条目一致。
 *
 * 和 compileResources.js 的 byResTypeThenName 是同一个规则 ——
 * C++ 的 std::string 比较本来就是字节序。
 */
function sortByDepthThenName(entries) {
  return entries.sort((a, b) => {
    const pa = (a.relPath + "/" + a.fileName).replace(/^\//, "");
    const pb = (b.relPath + "/" + b.fileName).replace(/^\//, "");
    const da = pa.split("/").length;
    const db = pb.split("/").length;
    if (da !== db) return da - db;
    if (pa === pb) return 0;
    return pa < pb ? -1 : 1;
  });
}

/** 把 collectFiles 的结果转成完整路径，例如 assets/js/default/app.js */
export function entryPath(e) {
  return ((e.relPath || "").replace(/^\//, "") + "/" + e.fileName).replace(/^\//, "");
}
