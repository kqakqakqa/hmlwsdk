/** 15 个任务共用的小工具 */

/**
 * 贯穿所有任务的 taskContext 形状（由 bin/hmlwsdk.js 创建，任务只读不建）
 *
 *   projectDir          工程根目录，例如 /path/to/apps/_empty/_empty
 *   moduleDir           entry 模块目录，等于 projectDir/entry
 *   work                中间产物目录，所有任务往这里写
 *   srcConfig           源码 config.json 解析出来的对象
 *   compileSdkVersion   来自 build.gradle
 *   compatibleSdkVersion 来自 defaultConfig
 *   config              加工过程中的 config 对象，逐任务往后传
 *   paths               各任务产出文件的路径，键名见各任务的 produces
 */
export function createTaskContext(fields) {
  return {
    paths: {},
    ...fields
  };
}

/**
 * 没实现的地方统一抛这个，报错信息里必须写清要产出什么
 * @param {string} name 任务名
 * @param {string} what 该产出什么
 */
export function todo(name, what) {
  throw new Error(`[TODO] ${name} is not implemented yet: ${what}`);
}
