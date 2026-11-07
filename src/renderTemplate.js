import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * 模板渲染 —— 生成到用户工程里的那些文件都以真实文件形式放在 templates/ 下
 *
 * 为什么不写在 JS 字符串里：hmlwsdk.config.js / hmlwsdk.build.js / build.config.js /
 * signing.config.js 都是要给用户读、让用户改的源码，塞进模板字符串里既要转义反引号和
 * `${`（hmlwsdk.build.js 里两者都有），又没法用编辑器打开、diff、格式化。
 * 落成真实文件之后，除了下面这几个占位符之外它们就是原样内容。
 *
 * 变量用 `{{name}}`，不用 `${name}` —— 后者在 .js 模板里会跟真正的模板字符串混淆。
 */

/** templates/ 在 SDK 根下，与 bin/ src/ doc/ 平级 */
export const TEMPLATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");

/**
 * @param {string} name relative to templates/, e.g. "projectInit/hmlwsdk.config.js"
 * @param {Record<string, string|number>} [vars] 占位符取值
 * @returns {string}
 */
export function renderTemplate(name, vars = {}) {
  const text = fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8");

  // 漏传就报错：留在产物里的 {{x}} 是个静默错误，比生成失败难查得多
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`template ${name} needs {{${key}}}, but no value was given for it`);
    return String(vars[key]);
  });
}
