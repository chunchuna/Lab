/**
 * 找一个能用的 Chrome。用户在 macOS 上跑，云端容器里是 Linux，
 * 每个脚本各写一份路径迟早会有一份是错的。
 *
 * 想指定别的：`CHROME=/path/to/chrome node tools/xxx.mjs`
 */
import fs from 'node:fs';

const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/local/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

export const CHROME = CANDIDATES.find((p) => p && fs.existsSync(p)) || CANDIDATES[1];
