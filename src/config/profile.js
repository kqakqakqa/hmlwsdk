/**
 * config.json 加工
 *
 * 对应 Gradle 的两个 task：
 *   mergeProfile   —— 把 build.gradle 里的 SDK 版本、variant 信息合进 config.json
 *   processProfile —— 再加工一遍（实测只调整了键顺序，内容不变）
 *
 * 实测依据：apps/_empty/_empty
 *   源码 entry/src/main/config.json                690 B
 *   → merge_profile/debug/config.json             1064 B
 *   → process_profile/debug/normal/config.json    1064 B
 *   → js/debug/source/lite/config.json            1137 B（多了 iconId / labelId）
 */

/**
 * 合并阶段：注入 apiVersion、variant 开关、abilities 默认值
 *
 * @param {object} source 源码里的 config.json
 * @param {object} opts
 * @param {number} opts.compileSdkVersion   来自 build.gradle 的 ohos.compileSdkVersion
 * @param {number} opts.compatibleSdkVersion 来自 defaultConfig.compatibleSdkVersion
 * @param {boolean} [opts.debug]            debug 变体时写 deviceConfig.default.debug = true
 * @param {string} [opts.releaseType]       默认 "Release"
 * @returns {object} 新的 config 对象（不改原对象）
 */
export function mergeProfile(source, opts) {
  const out = structuredClone(source);

  out.app ??= {};
  out.app.apiVersion = {
    compatible: opts.compatibleSdkVersion,
    target: opts.compileSdkVersion,
    releaseType: opts.releaseType ?? "Release"
  };

  out.deviceConfig ??= {};
  if (opts.debug) {
    out.deviceConfig.default = {
      ...(out.deviceConfig.default ?? {}),
      debug: true
    };
  }

  for (const ab of out.module?.abilities ?? []) {
    if (ab.homeAbility === undefined) ab.homeAbility = false;
  }

  return out;
}

/**
 * 加工阶段：实测 gradle 只调整了键顺序，没有增删字段。
 *
 * 这里保留成独立函数，是因为后续如果要按 SDK 版本做字段迁移（比如 apiVersion
 * 的写法在更高 API 上不一样），改动应该落在这个位置。
 */
export function processProfile(config) {
  return structuredClone(config);
}

/**
 * 序列化。实测 gradle 产出的 config.json 是：
 *   - 4 空格缩进
 *   - LF 换行
 *   - 文件末尾没有多余换行
 */
export function stringifyConfig(config) {
  return JSON.stringify(config, null, 4);
}
