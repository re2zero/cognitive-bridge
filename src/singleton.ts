/**
 * 单例管理：防止 OMP 中 Pi 扩展 + OpenCode 插件双重加载。
 * 
 * OMP 同时有 Pi 扩展系统和 OpenCode 插件系统，此模块确保
 * cog 只在一个系统中注册，另一个系统返回空实现。
 */

const LOG_TAG = '[cog:singleton]';

let initialized = false;
let initPath: string | null = null;

/**
 * 尝试获取初始化权。如果已被其他路径初始化，返回 false。
 */
export function tryInit(path: string): boolean {
  if (initialized) {
    console.error(`${LOG_TAG} Skipped ${path} — already initialized via ${initPath}`);
    return false;
  }
  initialized = true;
  initPath = path;
  const env = {
    pi: typeof process !== 'undefined' && !!process.env.PI_VERSION,
    opencode: typeof process !== 'undefined' && !!process.env.OPENCODE_VERSION,
    omp: typeof process !== 'undefined' && !!process.env.OMP_VERSION
  };
  console.error(`${LOG_TAG} Initialized via ${path} (env: pi=${env.pi}, opencode=${env.opencode}, omp=${env.omp})`);
  return true;
}

/**
 * 是否已初始化。
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * 获取当前初始化路径。
 */
export function getInitPath(): string | null {
  return initPath;
}
