/**
 * opencode 专用入口：只导出插件函数。
 * opencode 把所有导出都当作插件，所以这里只导出一个函数。
 */
import { initOpencodePlugin } from './index.js';

export default async function(ctx: any): Promise<any> {
  return await initOpencodePlugin(ctx);
}
