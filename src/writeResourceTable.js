/**
 * 写 R.txt
 *
 * 一行一个资源：`类型名 资源名 0x十六进制id`，行之间是 LF，**最后一行不带换行**。
 *
 * 排序和 id 分配是两套规则，别搞混：
 *   - id 分配按 ResType 数字升序，所以 string(9) 比 color(14) 先拿到 id
 *   - R.txt 的书写顺序按**类型名字典序**，所以 boolean / color / float … 排下来，
 *     string 反而靠后
 *
 * 实测对照（apps/_inactive/stock/stock，restool 现跑）：
 *   media icon 0x1000003
 *   media icon_small 0x1000004
 *   string MainAbility_desc 0x1000000
 *   string MainAbility_label 0x1000001
 *   string module_desc 0x1000002
 * 注意 media 排在 string 前面（字典序 m < s），但 id 是 string 更小。
 *
 * id 是十六进制**不补零**（0x1000003 就是 7 位），和源码里 setw(8) 的行为不一样，
 * 但 api6 的真实产物确实不补零，以产物为准。
 */

/**
 * @param {Array<{typeName:string, name:string, id:number}>} items
 * @returns {string}
 */
export function writeResourceTable(items) {
  const lines = [...items]
    .sort((a, b) => {
      if (a.typeName !== b.typeName) return a.typeName < b.typeName ? -1 : 1;
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      return 0;
    })
    .map((item) => `${item.typeName} ${item.name} 0x${item.id.toString(16)}`);

  // 每一行（包括最后一行）都跟着换行。实测 _empty 的 R.txt 是 73 B：
  // 三行正文共 70 B，加上三个 LF 才对得上；不写结尾换行会少 1 B
  return lines.length ? lines.join("\n") + "\n" : "";
}
