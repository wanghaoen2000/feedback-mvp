/**
 * 版本信息生成脚本
 * 在构建时自动生成版本信息文件，包含语义化版本号和 Git commit hash
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 版本号（手动维护，每次发布前更新）
const VERSION = 'V143';

// 获取 Git commit hash
let commitHash = 'unknown';
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch (e) {
  console.warn('无法获取 git commit hash');
}

// 获取构建时间
const buildTime = new Date().toISOString();

// 生成版本信息文件
const versionInfo = `// 此文件由构建脚本自动生成，请勿手动修改
// 生成时间: ${buildTime}

export const VERSION = '${VERSION}';
export const COMMIT_HASH = '${commitHash}';
export const BUILD_TIME = '${buildTime}';
export const VERSION_DISPLAY = '${VERSION} (${commitHash})';
`;

const outputPath = path.join(__dirname, '../client/src/version.generated.ts');
fs.writeFileSync(outputPath, versionInfo);
console.log(`[generate-version] 版本信息已生成: ${VERSION} (${commitHash})`);
