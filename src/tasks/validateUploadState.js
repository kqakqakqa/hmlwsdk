/**
 * validateUploadState —— 上架前检查：工程里不许有签名证书
 *
 * status: not planned
 *
 * 为什么不做：
 * 它属于「源码上传链」（zipSources → validateUploadState），是给华为应用市场
 * 交源码包时用的检查，跟出包完全无关。而且它不是 @OhosTask，只是 root 工程上的
 * 普通 DefaultTask。
 *
 * 要实现得先读 build.gradle 的 signingConfigs，那需要 Groovy DSL 解析器 ——
 * 本 SDK 的定位是出包，不打算为了一个上架检查去写 Groovy 解析。
 *
 * Gradle 原本的动作（留档）：
 *   1. 遍历所有工程的 signingConfigs
 *   2. 逐个用 KeyStoreHelper.isUseDefaultSignConfig 判断
 *   3. 只要有一个不是默认配置，就抛异常：
 *      "Packaging source files should not have signing configurations."
 *
 * 保留这个文件只是让任务清单和 doc/gradle-build-report.html 的卡片对得上。
 * 没有任何出包入口会走到它（DEPENDS 里只有 zipSources 依赖它）。
 */

export const name = "validateUploadState";
export const status = "not planned";
export const produces = "无";

export function run() {
  return null;
}
