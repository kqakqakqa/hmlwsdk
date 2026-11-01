import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

import { resolveTools } from "../core/sdk.js";

/**
 * 调 restool.exe 编译资源
 *
 * 实测参数（对应 Gradle 的 compileDebugResources）：
 *   -i  **模块根** src/main —— 不是 src/main/resources。传 resources 目录会报
 *       "Error: config.json ref:'$media:icon' don't be defined"
 *       （restool 要在 -i 下面自己找 resources/base/...，实测 restool 1.022）
 *   -j  加工后的 config.json
 *   -p  bundleName
 *   -o  输出目录（必须先存在，否则报 "not directory or exists"）
 *   -r  资源头文件路径，必须以 .java 结尾；传 .txt 会报 Invalid header file
 *   -m  模块名
 *   -f  输出目录存在时强删
 *   -z  压缩图片（opts.compressImage）
 *
 * 没有 -b：api6 的 restool 1.022 不支持（传了只输出
 *   "Warning: unsupport parameter: 98"，98 是 'b' 的 ASCII），它只存在于 api7。
 *
 * 实测结果（apps/_empty/_empty）：
 *   仓库这份 restool -v 报 Restool 1.022，与 Gradle 当时同版本
 *   R.txt            73 B，SHA256 651EFBDB…，与 Gradle 产物完全一致
 *   resources.index  337 B，SHA256 08F3CD66…，与 Gradle 产物完全一致
 *   icon.png         加 -z 后 6320 B / SHA256 D8734140…，同样一致
 *                    （不加 -z 是源码原图 6790 B）
 *
 * @returns {{ok:boolean, code:number, stdout:string, stderr:string, outDir:string, indexFile:string, rTxtFile:string, headerFile:string}}
 */
export function compileResources(opts) {
  const tools = opts.tools ?? resolveTools(opts.sdkRoot);

  const outDir = opts.outDir;
  const headerDir = opts.headerDir ?? path.dirname(outDir);

  fs.mkdirSync(outDir, { recursive: true });

  const headerFile = path.join(headerDir, "ResourceTable.java");

  const args = [
    // 名字就叫 moduleRoot：-i 要的是模块根 src/main，不是 src/main/resources。
    // 早先叫 resourcesDir，名字本身就在误导（实测踩过一次）。
    "-i", opts.moduleRoot,
    "-j", opts.configPath,
    "-p", opts.bundleName,
    "-o", outDir,
    "-r", headerFile,
    "-m", opts.moduleName ?? "entry"
  ];

  // -b 只有 api7 的 restool 认。api6 的 1.022 传了只会输出
  // "Warning: unsupport parameter: 98"（98 = 'b'）并被忽略，产物不受影响。
  // 这个开关留着给换 api7 restool 时用，liteWearable 默认不传。
  if (opts.variantsDir) args.push("-b", opts.variantsDir);
  if (opts.force !== false) args.push("-f");
  if (opts.incremental) args.push("-c");
  if (opts.compressImage) args.push("-z");

  const r = spawnSync(tools.restool, args, { encoding: "utf8" });

  const indexFile = path.join(outDir, "resources.index");
  const rTxtFile = path.join(outDir, "R.txt");

  return {
    ok: r.status === 0 && fs.existsSync(indexFile),
    code: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    outDir,
    indexFile,
    rTxtFile,
    headerFile: findHeaderFile(headerDir)
  };
}

function findHeaderFile(dir) {
  // restool 会把 ResourceTable.java 放到按包名展开的子目录里
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let items;
    try {
      items = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const it of items) {
      const p = path.join(cur, it.name);
      if (it.isDirectory()) stack.push(p);
      else if (it.name === "ResourceTable.java") return p;
    }
  }
  return null;
}
