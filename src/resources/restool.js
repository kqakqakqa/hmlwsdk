import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

import { resolveTools } from "../sdk.js";

/**
 * 调 restool.exe 编译资源
 *
 * 实测参数（对应 Gradle 的 compileDebugResources）：
 *   -i  资源目录（标准结构 resources/base/media/...）
 *   -b  variants 目录，实测传 entry/src/main
 *   -j  加工后的 config.json
 *   -p  bundleName
 *   -o  输出目录
 *   -r  资源头文件路径，必须以 .java 结尾；传 .txt 会报 Invalid header file
 *   -m  模块名
 *   -f  输出目录存在时强删
 *
 * 实测结果（apps/_empty/_empty，restool 1.028 vs gradle 当时的 1.022）：
 *   R.txt            73 B，SHA256 完全一致
 *   resources.index  337 B，仅版本号字符串不同，其余 336 字节相同
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
    "-i", opts.resourcesDir,
    "-j", opts.configPath,
    "-p", opts.bundleName,
    "-o", outDir,
    "-r", headerFile,
    "-m", opts.moduleName ?? "entry"
  ];

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
