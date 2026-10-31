import { todo } from "./_util.js";

/**
 * zipSources —— 把整个工程打成 source.zip，给上架用
 *
 * 实现类叫 ZipSources，直接继承 Gradle 原生 Zip 任务：
 * 没有 @TaskAction，全部在配置期完成。
 *
 * Gradle 的动作：
 *   1. from(projectDir)，打包名固定 source.zip，落到 build/source/
 *   2. 默认忽略 .idea / .gradle / build，再读各子工程 .gitignore 追加规则
 *   3. 执行前先数文件，超过 5000 个直接抛异常
 *   4. 执行后把忽略清单写成 excludedFiles.txt
 *
 * 底层 zip 读写本 SDK 已有（src/zip/read.js、write.js，含自实现 crc32），
 * 所以这个任务缺的只是遍历 + 过滤规则，不是格式问题。
 * 但它跟出包没关系，优先级最低。
 */

export const name = "zipSources";
export const produces = "build/source/source.zip + excludedFiles.txt";

export function run() {
  todo(
    name,
    "要遍历 projectDir、按 .idea/.gradle/build + 各 .gitignore 过滤、数文件超 5000 报错，" +
      "再用 src/zip/write.js 打包，最后写 excludedFiles.txt"
  );
}

export function verify() {
  return { ok: false, detail: "还没实现" };
}
