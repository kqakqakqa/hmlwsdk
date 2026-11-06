import fs from "fs";
import path from "path";

import { todo } from "./createTaskContext.js";

/**
 * processReleaseJavaRes —— 把 jar 里的资源抽到暂存目录
 *
 * 反编译依据（com.huawei.ohos.build.tasks.ProcessJavaRes）：
 *   - 注册条件 taskShouldCreate = !isHarModule()，所以 entry 一定会执行它
 *   - 逻辑在 _run_closure1：project.zipTree(...) 再 copy{}
 *     内层闭包设 from / into(resourcesBuildRoot) / exclude(packageOptions.getExcludes())
 *   - 日志标签 PackageJarRes
 *
 * 输入是两批 jar：编译器产出的 classes.jar + 每个 HAR 库自带的 jar。
 * liteWearable 纯 JS 工程两批都是空的，所以它每次执行都是复制 0 个文件。
 *
 * 它**不是空函数** —— 只是没输入。哪天工程引用 HAR 或带 Java 代码，
 * 这个任务就要真的实现。
 */

export const name = "processReleaseJavaRes";
export const produces = "jarRes/release/ directory (empty in this project)";

export function run(taskContext) {
  const outDir = path.join(taskContext.work, "jarRes", "release");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const jars = taskContext.javaJars ?? [];

  if (jars.length === 0) {
    // 与 Gradle 行为一致：清空目录、复制 0 个文件、正常结束
    taskContext.paths.jarRes = outDir;
    return outDir;
  }

  todo(name, `${jars.length} jar(s) to process (unzip via zipTree + filter by packageOptions.excludes), this part is not written yet`);
}
