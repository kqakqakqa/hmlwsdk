import fs from "fs";
import path from "path";

import { writeBin } from "./readWriteBin.js";
import { todo } from "./createTaskContext.js";

/**
 * generateReleaseJsBin —— 把 source/lite 目录压成 .bin 私有容器
 *
 * Gradle 是调 java -jar hmos_haptobin_tool.jar --bin <源目录> --project <输出文件>。
 * 本 SDK 用纯 JS 的 writeBin 顶替它，序列化格式已用 4 个真实 .bin 验证过
 * 字节级一致。
 *
 * .bin 内部条目布局（实测 apps/devdemo/devdemo，release 产物）：
 *   config.json
 *   assets/entry/resources.index
 *   assets/entry/resources/base/media/*.key|*.bin|*.png
 *   assets/entry/resources/rawfile/*.txt
 *   assets/js/default/app.js / app.bc / manifest.json
 *   assets/js/default/common/*.bin|*.png
 *   assets/js/default/pages/ 下每个页面各一个 .js 和一个 .bc
 *
 * 未验证项：条目排序规则。参考 hap-sign-utils 的 hapToBin 是「按路径深度 + 字典序」，
 * 这里照此实现，但没拿真实产物逐条核对过顺序。
 */

export const name = "generateReleaseJsBin";
export const produces = "bin/release/entry-release-unsigned.bin";

/** 遍历目录，拆成 { fileName, relPath, content } 列表（packageReleaseHap 也用它打文件树形态） */
export function collect(dir, root = dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      collect(full, root, acc);
      continue;
    }
    const rel = path.relative(root, dir).replace(/\\/g, "/");
    acc.push({
      fileName: ent.name,
      relPath: rel === "" ? "" : "/" + rel,
      content: fs.readFileSync(full)
    });
  }
  return acc;
}

/** 按路径深度、再按字典序排（照抄 hap-sign-utils 的 hapToBin，未验证） */
export function sortEntries(entries) {
  return entries.sort((a, b) => {
    const pa = (a.relPath + "/" + a.fileName).replace(/^\//, "");
    const pb = (b.relPath + "/" + b.fileName).replace(/^\//, "");
    const da = pa.split("/").length;
    const db = pb.split("/").length;
    return da !== db ? da - db : pa.localeCompare(pb);
  });
}

export function run(taskContext) {
  if (!taskContext.paths.binSource) todo(name, "缺少 binSource 目录，必须先跑 generateReleaseBinSource");

  const entries = sortEntries(collect(taskContext.paths.binSource));
  if (entries.length === 0) todo(name, "binSource 目录是空的，组装 assets 那步还没完成");

  const outDir = path.join(taskContext.work, "bin", "release");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "entry-release-unsigned.bin");

  const buf = writeBin({
    bundleName: taskContext.config.app.bundleName,
    entries
  });
  fs.writeFileSync(out, buf);

  taskContext.paths.unsignedBin = out;
  return out;
}
