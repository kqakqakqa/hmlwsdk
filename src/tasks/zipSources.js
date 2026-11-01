/**
 * zipSources —— 把整个工程打成 source.zip，给上架用
 *
 * status: not planned
 *
 * 为什么不做：
 * 它是「源码上传链」的入口，产出是交给华为应用市场的源码包（source.zip），
 * 跟出包完全无关 —— 不是 hap，不是 .app，装不到设备上。
 *
 * 底层 zip 读写本 SDK 已经有了（src/zip/read.js、write.js，含自实现 crc32），
 * 所以真要做也只是遍历 + 过滤规则，不是格式问题。取舍是这个功能和
 * 「用 Node 替代 Gradle 出包」这个目标没关系，不值得花时间。
 *
 * Gradle 原本的动作（留档）：
 *   实现类 ZipSources，直接继承 Gradle 原生 Zip 任务，没有 @TaskAction。
 *   1. from(projectDir)，打包名固定 source.zip，落到 build/source/
 *   2. 默认忽略 .idea / .gradle / build，再读各子工程 .gitignore 追加规则
 *   3. 执行前先数文件，超过 5000 个直接抛异常
 *   4. 执行后把忽略清单写成 excludedFiles.txt
 *
 * 保留这个文件只是让任务清单和 doc/gradle-build-report.html 的卡片对得上。
 * 没有任何出包入口会走到它。
 */

export const name = "zipSources";
export const status = "not planned";
export const produces = "无";

export function run() {
  return null;
}
