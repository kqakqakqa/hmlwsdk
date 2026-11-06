import { todo } from "./createTaskContext.js";

/**
 * validateReleaseDistroFilterTask —— 检查各 entry 模块的 distroFilter 有没有冲突
 *
 * 这是插件里唯一有实质校验逻辑的 validate 任务（对比那些名字叫 validate
 * 但方法体是空的，差别就在这里）。它跑在 root 工程上。
 *
 * Gradle 的动作：
 *   1. 遍历各子工程，只处理 entry 模块
 *   2. 按 config.json 里的 deviceType 分桶
 *   3. 同一 deviceType 下 entry 多于 1 个时，任何一个缺 distroFilter 就抛异常
 *   4. 逐项校验三个维度：apiVersion / screenWindow / screenShape
 *   5. 同一维度内做唯一性与互斥检查
 *
 * 本工程是单 entry、无 flavor，所以实际一步都不会走进校验分支。
 */

export const name = "validateReleaseDistroFilterTask";
export const produces = "no output, validation only";

export function run(taskContext) {
  const entries = taskContext.entryModules ?? [taskContext.moduleDir];

  // 单 entry 时与 Gradle 一样直接通过
  if (entries.length <= 1) {
    return null;
  }

  todo(
    name,
    `${entries.length} entry modules, this needs deviceType bucketing plus the three-dimensional distroFilter exclusivity check, not written yet`
  );
}
