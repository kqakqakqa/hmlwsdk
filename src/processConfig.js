/**
 * config.json 加工
 *
 * 这件事原本拆成两步：注入版本信息、再加工一遍。
 * 但第二步实测只调整了键顺序、内容一个字都没变（api6 的 1.022 上），
 * 所以本 SDK 只做一遍。
 *
 * 唯一还剩的第二个阶段是「回填资源 id」（parseResourceTable.js 的 fillResourceIds），
 * 它必须等资源编译出 R.txt 才能做，所以留在 assembleAssets 里，不在这。
 *
 * 实测依据：apps/_empty/_empty
 *   源码 entry/src/main/config.json        690 B
 *   → Gradle 的 process_profile 产物      1064 B
 *   → 最终打进包的 config.json            1137 B（多了 iconId / labelId）
 */

/**
 * 注入 apiVersion、abilities 默认值
 *
 * release 变体不写 deviceConfig.default.debug。实测 devdemo 的 release config.json 里
 * deviceConfig 是空对象 {}，而 debug 那份是 {"default":{"debug":true}}。
 * debug 变体本 SDK 不做（debug 只出 1 个 .bin 形态的包、webpack 还不压缩，发布用不上），
 * 所以那个分支没必要存在。
 *
 * @param {object} source 源码里的 config.json
 * @param {object} opts
 * @param {number} opts.compileSdkVersion   来自 build.config.js 的 compileSdkVersion
 * @param {number} opts.compatibleSdkVersion 来自 build.config.js 的 compatibleSdkVersion
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

  for (const ab of out.module?.abilities ?? []) {
    if (ab.homeAbility === undefined) ab.homeAbility = false;
  }

  return out;
}

/**
 * 序列化。格式必须逐字节固定，不一致产物就差 98 B。
 *
 * 实测两个格式差异（devdemo release 的 config.json，Gradle 3422 B vs 我们 3324 B）：
 *
 * 1. 非 ASCII 字符转义。Gradle 写 "\u4f20\u611f\u5668..."，我们直接写中文。
 *    "传感器订阅功能" 7 个中文 = 21 字节，转义后 42 字节，4 处共差 84 B。
 *
 * 2. 空对象带换行。Gradle 写：
 *        "deviceConfig": {
 *
 *        },
 *    中间那行是「缩进 + 4 个空格」的空行。我们写的是 `"deviceConfig": {},`，差约 15 B。
 *
 * 84 + 15 ≈ 98 B，正好对上总差异。
 */
export function stringifyConfig(config) {
  return (
    JSON.stringify(config, null, 4)
      // 非 ASCII → \uXXXX（小写十六进制，与 Java 一致）
      .replace(/[^\x00-\x7F]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
      // 空对象展开成三行，中间是「当前缩进 + 4 空格」的空行
      .replace(
        /^(\s*)"([^"]+)": \{\}(,?)$/gm,
        (_, ind, key, comma) => `${ind}"${key}": {\n${ind}    \n${ind}}${comma}`
      )
  );
}

/**
 * 紧凑版序列化 —— 打进文件树形态 hap 的那个 config.json
 *
 * 实测（devdemo release）：hap 里的 config.json 是 1935 B 单行，
 * 而 source/lite 里的是 3422 B 缩进版。两者内容一样，只是排版不同。
 *
 * 单行版的格式特征是「冒号后一个空格、逗号后没有空格」：
 *   {"app": {"apiVersion": {"compatible": 3,"releaseType": "Release",...
 *
 * 那个 replace 只影响键值分隔符：JSON 字符串内部的引号一定会被转义成 \"，
 * 所以未转义的 `":` 只可能是「键结束 + 冒号」，不会误伤值里的内容。
 */
export function stringifyConfigMinified(config) {
  return JSON.stringify(config)
    .replace(/[^\x00-\x7F]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
    .replace(/":/g, '": ');
}
