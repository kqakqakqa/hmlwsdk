import fs from "fs";
import path from "path";

import { todo } from "./createTaskContext.js";

/**
 * processReleaseLibsFile —— 收集 .so 动态库
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

export const name = "processReleaseLibsFile";
export const produces = "libs/release/ directory (empty in this project)";

export function run(taskContext) {
  const outDir = path.join(taskContext.work, "libs", "release");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // 三路输入，逐路找 .so
  const sources = [
    taskContext.harLibsDir, // HAR 库
    path.join(taskContext.moduleDir, "libs"), // 工程自己的 libs/
    taskContext.cmakeDir // CMake 产出
  ].filter(Boolean);

  const found = [];
  for (const dir of sources) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir, { recursive: true })) {
      if (String(f).endsWith(".so")) found.push(path.join(dir, String(f)));
    }
  }

  if (found.length === 0) {
    taskContext.paths.libs = outDir;
    return outDir;
  }

  todo(name, `found ${found.length} .so (${found.slice(0, 3).join(", ")}), the copy logic is not written yet`);
}
