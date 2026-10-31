/** 31 个任务共用的小工具 */

/**
 * 贯穿所有任务的 ctx 形状（由 build.js 创建，任务只读不建）
 *
 *   projectDir          工程根目录，例如 E:/repo/hmlw/apps/_empty/_empty
 *   moduleDir           entry 模块目录，等于 projectDir/entry
 *   variant             "debug" | "release"
 *   work                中间产物目录，所有任务往这里写
 *   sample              可选：Gradle 旧产物目录，只有 verify() 用
 *   srcConfig           源码 config.json 解析出来的对象
 *   compileSdkVersion   来自 build.gradle
 *   compatibleSdkVersion 来自 defaultConfig
 *   config              加工过程中的 config 对象，逐任务往后传
 *   paths               各任务产出文件的路径，键名见各任务的 produces
 */
export function createCtx(fields) {
  return {
    variant: "debug",
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
  throw new Error(`[TODO] ${name} 还没实现 —— ${what}`);
}

/** 深比较，忽略对象键顺序（gradle 用 Java HashMap，键序无语义） */
export function deepEqual(a, b, path = "") {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${path}: 类型不同 ${typeof a} vs ${typeof b}`;
  if (a === null || b === null) return `${path}: ${a} vs ${b}`;
  if (typeof a !== "object") return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;

  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  const onlyA = ka.filter((k) => !kb.includes(k));
  const onlyB = kb.filter((k) => !ka.includes(k));
  if (onlyA.length) return `${path}: 少了 ${onlyA.join(",")}`;
  if (onlyB.length) return `${path}: 多了 ${onlyB.join(",")}`;

  for (const k of ka) {
    const d = deepEqual(a[k], b[k], path ? `${path}.${k}` : k);
    if (d) return d;
  }
  return null;
}
