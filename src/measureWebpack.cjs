/**
 * webpack 计时壳（CommonJS）
 *
 * 为什么必须是 .cjs：webpack 4 的 --config 只认 CommonJS，而本包的 package.json
 * 是 "type": "module"，不写 .cjs 后缀会被当成 ESM 直接语法错误。
 *
 * 为什么包一层，而不是改 ace-loader 的 webpack.lite.config.js：那是 submodule，
 * 挂着上游来源，改它会让「本地这份和上游差多少」更难判断。这里 require 它、
 * 原样调用、只 push 一个插件，产物路径和 loader 链一个字都不动。
 *
 * 真实配置路径从环境变量 HMLWSDK_ACE_CONFIG 拿 —— 壳文件自己也可能是被
 * 从别的 cwd 调起来的，不能靠相对路径去猜。
 *
 * 时间戳走 stderr，由 src/runWebpack.js 解析。不走 stdout 是因为那里有
 * ace-loader 的 "COMPILE RESULT:SUCCESS"，别混。
 *
 * ⚠ 必须**每个阶段结束就立刻打一行**，不能等 done 一次性吐：
 * webpack 一次要跑 5 s，攒到最后再输出的话，终端在这 5 s 里是空的，
 * 读数的人看不出卡在哪。runWebpack 因此用的是 spawn（流式）而不是 spawnSync。
 *
 * 量出来的阶段对应 webpack 4 的 hook 时序（实测 devdemo release，25 个页面）：
 *   bootstrap  进程启动 → 配置加载完      1.3 s  含 node 起跑和 webpack/babel/postcss 的 require
 *   init       配置加载完 → make 开始     0.3 s  编译器初始化
 *   make       make → terser 开始         2.3 s  模块构建，loader 链都在这段里
 *   terser     optimizeChunkAssets        0.5 s  压缩
 *   write      emit → afterEmit           0.03 s 写盘
 *   tail       afterEmit → done           0.6 s  收尾与结果上报
 *
 * 事件格式（一行一个 JSON，前缀 HMLWSDK_TIMING:）：
 *   { t: "title",  d, name }          d 是相对 webpack 的层级，0 就是 webpack 自己
 *   { t: "detail", d, name, ms }
 *   { t: "total",  d, name, ms }      收尾行，d=0 那条（webpack 总时长）由 runWebpack 补
 */

const TIMING_PREFIX = "HMLWSDK_TIMING:";

/** 立刻吐出，不缓冲：SDK 侧边读边打印 */
const emit = (event) => process.stderr.write(TIMING_PREFIX + JSON.stringify(event) + "\n");

/**
 * 模块自身耗时，按**真实源文件**逐行输出
 *
 * 为什么不等全部建完再排序输出：webpack 的 make 阶段在 devdemo 上要 2.3 s，
 * 攒到最后一次吐的话这 2.3 s 里终端一片空白，看不出是在编译还是卡死了。
 * 所以**一个文件建完就立刻报一行**，代价是按构建顺序而不是按耗时排序。
 *
 * 「自身」= 模块总耗时 − 它 build 期间触发的子模块耗时。只对**最外层**模块输出：
 * webpack 4 会把 loader 链拆成独立模块，一个
 *   /entry/.../pages/index/index.hml
 * 会变成 lib/json.js!lib/template.js!…index.hml 和 index.hml 两个模块，两层都报
 * 就是同一个文件两行。内层的时间累加到父层，只在父层完成时报一次，
 * 数字就是这个文件的总耗时（实测与按文件合并的结果一致）。
 *
 * 名字取 loader 链最后一段（真实文件），相对 aceModuleRoot。
 */
class HmlwsdkTimingPlugin {
  constructor(timing) {
    // boot：相对**进程启动**的毫秒数（performance.timeOrigin 基准），只用来做 bootstrap
    // configAt：配置加载完的**绝对**时间戳，后续几段都用绝对时间戳相减，
    //          两者混用会算出天文数字（绝对 1794162… 减相对 1326）
    this.boot = timing.boot;
    this.configAt = timing.configAt;
  }

  apply(compiler) {
    const t = { boot: this.boot, configAt: this.configAt };
    // 嵌套的模块构建栈：webpack 4 在父模块 build 期间会同步 build 子模块
    // （loader 链就是这么拆出来的），靠它区分"内层"和"最外层"
    const stack = [];

    // 文件名相对 aceModuleRoot 显示 —— 绝对路径太长，一屏放不下几行
    const moduleRoot = String(process.env.aceModuleRoot ?? "").replace(/\\/g, "/");

    /**
     * 模块所属的真实源文件：loader 链最后一段，去掉 query 和 moduleRoot 前缀
     *
     * 链中间层（lib/json.js!lib/template.js!…hml）和真实文件归到同一个名字，
     * 两者耗时会相加 —— 这才是这个文件真正花掉的时间。
     *
     * 不在组件目录下的（babel runtime 的 helper、webpack 的输入 manifest.json）
     * 也压成短名：node_modules 里的从 node_modules/ 之后算起，其它只留文件名。
     * 不压的话一行能到 100 多字符，把数字列挤得没法看。
     */
    const nameOf = (m) => {
      const req = String(m.request ?? m.userRequest ?? m.resource ?? "");
      let file = (req.split("!").pop() ?? "").replace(/\\/g, "/").split("?")[0];
      if (moduleRoot && file.startsWith(moduleRoot)) {
        file = file.slice(moduleRoot.length).replace(/^\/+/, "");
      } else {
        const nm = file.indexOf("/node_modules/");
        file = nm >= 0 ? file.slice(nm + "/node_modules/".length) : (file.split("/").pop() ?? file);
      }
      return file || "(unknown)";
    };

    // 名字列宽固定：实时输出没法先统计出最长名字，只能定一个够用的宽度，
    // 好让数字对齐成一列。62 = devdemo 里最长那个相对路径（51 字符，
    // pages/demo_sensorSubscribe/demo_sensorSubscribe.hml）加 " (loaders)" 后缀；
    // 更长的截断加 …
    const FILE_WIDTH = 62;
    const clip = (s) => (s.length <= FILE_WIDTH ? s : `${s.slice(0, FILE_WIDTH - 1)}…`);

    /**
     * 已经报过的文件名
     *
     * webpack 把一条 loader 链拆成两个模块，一个 .hml 会完成两遍：
     *   xxx.hml                             本体，先完成，几毫秒
     *   lib/json.js!lib/template.js!xxx.hml 链层，后完成，真正的编译时间在这
     * 两个都报，后出现的加 (loaders) 后缀 —— 不合并是因为两者不一定是父子
     * （中间可能隔着几层 loader 模块），按栈配对实测会漏掉一部分。
     */
    const seen = new Set();

    const finishModule = (m) => {
      const node = stack.pop();
      if (!node) return;
      const dur = Date.now() - node.t;
      // 父模块要扣掉子模块的时间，否则重复累加（98 个模块能累出 32 s）
      if (stack.length) stack[stack.length - 1].child += dur;

      // 一个模块建完就立刻报一行。不能等「最外层」再报：webpack 4 的模块构建
      // 是深度嵌套的（实测 devdemo 最大栈深 23，98 个模块里只有 3 个在栈底），
      // 按最外层报就只剩 3 行。所以报的是**每个模块自己的耗时**
      const self = dur - node.child;
      const name = nameOf(m);
      const dup = seen.has(name);
      if (!dup) seen.add(name);
      emit({ t: "detail", d: 2, name: clip(dup ? `${name} (loaders)` : name), ms: self, w: FILE_WIDTH });
    };

    compiler.hooks.beforeCompile.tap("HmlwsdkTiming", () => {
      t.beforeCompile = Date.now();
    });

    // make 开始：说明 init 这段结束了，同时把 make 的标题先挂出来 ——
    // 接下来这两秒多都在构建模块，屏幕上要有东西告诉人卡在这儿不是死了
    compiler.hooks.make.tap("HmlwsdkTiming", () => {
      t.make = Date.now();
      emit({ t: "detail", d: 1, name: "init", ms: t.make - t.configAt });
      emit({ t: "title", d: 1, name: "make" });
    });

    compiler.hooks.compilation.tap("HmlwsdkTiming", (compilation) => {
      // ace-loader 的模板/样式编译会开 child compilation，那里的模块会被再 build
      // 一遍，同一个文件于是出现两次。只统计主编辑
      if (compilation.compiler.isChild && compilation.compiler.isChild()) return;

      compilation.hooks.buildModule.tap("HmlwsdkTiming", (m) => {
        stack.push({ m, t: Date.now(), child: 0 });
      });
      compilation.hooks.succeedModule.tap("HmlwsdkTiming", finishModule);
      compilation.hooks.failedModule.tap("HmlwsdkTiming", finishModule);
      compilation.hooks.optimizeChunkAssets.tapAsync("HmlwsdkTiming", (_chunks, cb) => {
        if (t.terserStart === undefined) {
          t.terserStart = Date.now();
          // 每个文件的明细已经在 buildModule/succeedModule 里逐条发过了，
          // 这里只收尾 make 那一行
          emit({ t: "total", d: 1, name: "make", ms: t.terserStart - t.make });
        }
        cb();
        t.terserEnd = Date.now();
        emit({ t: "detail", d: 1, name: "terser", ms: t.terserEnd - t.terserStart });
      });
    });

    compiler.hooks.afterCompile.tap("HmlwsdkTiming", () => {
      t.afterCompile = Date.now();
    });
    compiler.hooks.emit.tap("HmlwsdkTiming", () => {
      t.emit = Date.now();
    });
    compiler.hooks.afterEmit.tap("HmlwsdkTiming", () => {
      t.afterEmit = Date.now();
      emit({ t: "detail", d: 1, name: "write", ms: t.afterEmit - t.emit });
    });
    compiler.hooks.done.tap("HmlwsdkTiming", () => {
      // done 之后进程还要打 stats、退出，SDK 等子进程 close 才补 webpack 的总时长
      emit({ t: "detail", d: 1, name: "tail", ms: Date.now() - t.afterEmit });
    });
  }
}

module.exports = (_env, argv) => {
  const aceConfigPath = process.env.HMLWSDK_ACE_CONFIG;
  if (!aceConfigPath) {
    throw new Error("HMLWSDK_ACE_CONFIG is not set, cannot locate ace-loader's webpack config");
  }
  const base = require(aceConfigPath);
  const configAt = Date.now();
  // 相对进程启动的毫秒数：包含 node 起跑、webpack-cli 起跑、以及 require 到的
  // webpack / @babel / postcss 等库 —— 这一段占了整条链的两成多，单列出来。
  // performance.timeOrigin 带小数，取整免得输出 1326.9560546875 这种东西
  const boot = Math.round(configAt - performance.timeOrigin);

  const config = base(_env, argv);
  config.plugins.push(new HmlwsdkTimingPlugin({ boot, configAt }));

  // 配置加载完就立刻把标题和 bootstrap 打出去：这是 webpack 起跑前唯一能报的进度，
  // 打完终端就不再是空的
  emit({ t: "title", d: 0, name: "webpack" });
  emit({ t: "detail", d: 1, name: "bootstrap", ms: boot });
  return config;
};
