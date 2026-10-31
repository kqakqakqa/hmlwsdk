import fs from "fs";
import path from "path";

import { todo } from "./_util.js";

/**
 * processDebugLibsFile —— 收集 .so 动态库
 *
 * 反编译依据（com.huawei.ohos.build.tasks.ProcessLibsFile）：
 *   - 三路输入对应 getInputHarLibsFiles() / getLibsDir() / getBuildCmakeDir()
 *     （引用的 HAR 库 / 工程自己的 libs 目录 / CMake 编译产出）
 *   - 内层闭包里只有一个字符串常量，是「任意子目录下的 .so」这种通配，传给 include
 *   - 空目录不保留
 *
 * .so 是 C/C++ 编译出来的动态库（游戏引擎、图片解码器这类）。
 * liteWearable 跑的是 JerryScript 纯 JS 引擎，工程里没有 native 代码，
 * 所以这个任务在纯 JS 工程里永远是 0 个文件。
 *
 * 它**不是空函数** —— 三路输入都真去扫，只是都扫不到东西。
 */

export const name = "processDebugLibsFile";
export const produces = "libs/<variant>/ 目录（本工程是空的）";

export function run(ctx) {
  const outDir = path.join(ctx.work, "libs", ctx.variant);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // 三路输入，逐路找 **/*.so
  const sources = [
    ctx.harLibsDir, // HAR 库
    path.join(ctx.moduleDir, "libs"), // 工程自己的 libs/
    ctx.cmakeDir // CMake 产出
  ].filter(Boolean);

  const found = [];
  for (const dir of sources) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir, { recursive: true })) {
      if (String(f).endsWith(".so")) found.push(path.join(dir, String(f)));
    }
  }

  if (found.length === 0) {
    ctx.paths.libs = outDir;
    return outDir;
  }

  todo(name, `找到 ${found.length} 个 .so（${found.slice(0, 3).join(", ")}），复制逻辑还没写`);
}

export function verify(ctx) {
  const theirs = path.join(ctx.sample, "build", "intermediates", "libs", ctx.variant);
  if (!fs.existsSync(theirs)) return { ok: false, detail: `没有对照产物：${theirs}` };

  const count = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).length : 0);
  const mine = count(ctx.paths.libs);
  const want = count(theirs);
  if (mine !== want) return { ok: false, detail: `文件数不同：我 ${mine}，gradle ${want}` };
  return { ok: true, detail: `${want} 个文件，与 gradle 一致` };
}
