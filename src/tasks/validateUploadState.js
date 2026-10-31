import { todo } from "./_util.js";

/**
 * validateUploadState —— 上架前检查：工程里不许有签名证书
 *
 * 它没有 @OhosTask 注解，是 root 工程上的普通 DefaultTask。
 *
 * Gradle 的动作：
 *   1. 遍历所有工程的 signingConfigs
 *   2. 逐个用 KeyStoreHelper.isUseDefaultSignConfig 判断
 *   3. 只要有一个不是默认配置，就抛异常：
 *      "Packaging source files should not have signing configurations."
 *
 * 逻辑很简单，但我们的 SDK 目前还读不了 build.gradle 里的 signingConfigs
 * （没有 Groovy DSL 解析器），所以没法实现。
 */

export const name = "validateUploadState";
export const produces = "无产物，纯校验";

export function run() {
  todo(
    name,
    "要读各模块 build.gradle 的 signingConfigs 并逐个判断是否默认配置，" +
      "需要先有 build.gradle 的解析逻辑"
  );
}

export function verify() {
  return { ok: false, detail: "还没实现，依赖 build.gradle 解析" };
}
