/**
 * 游戏内调试控制台。波浪号（` / ~）开关。
 * 必须放在 #stage 外面：舞台有 transform，position:fixed 会被裁掉。
 */

const HISTORY_MAX = 40;
const LOG_MAX = 80;

let root;
let logEl;
let input;
let open = false;
let runCmd = null;
const history = [];
let histI = -1;
let draft = '';

export function isDevconOpen() {
  return open;
}

export function initDevcon(onCommand) {
  runCmd = onCommand;
  root = document.getElementById('devcon');
  logEl = document.getElementById('devcon-log');
  input = document.getElementById('devcon-in');
  if (!root || !input) return;

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      hist(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      hist(1);
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  });

  print('调试控制台  ·  输入 help 看指令，~ 或 Esc 关闭');
}

export function toggleDevcon() {
  if (open) closeDevcon();
  else openDevcon();
  return open;
}

export function openDevcon() {
  if (!root || open) return;
  open = true;
  root.classList.remove('hidden');
  document.body.classList.add('devcon-on');
  histI = -1;
  draft = '';
  input.value = '';
  setTimeout(() => input.focus(), 0);
}

export function closeDevcon() {
  if (!root || !open) return;
  open = false;
  root.classList.add('hidden');
  document.body.classList.remove('devcon-on');
  input.blur();
}

export function print(text, kind = '') {
  if (!logEl) return;
  String(text).split('\n').forEach((line) => {
    const d = document.createElement('div');
    if (kind) d.className = kind;
    d.textContent = line;
    logEl.appendChild(d);
  });
  while (logEl.children.length > LOG_MAX) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

function submit() {
  const line = input.value.trim();
  input.value = '';
  histI = -1;
  draft = '';
  if (!line) return;
  if (history[history.length - 1] !== line) {
    history.push(line);
    if (history.length > HISTORY_MAX) history.shift();
  }
  print('> ' + line, 'in');
  if (line.toLowerCase() === 'clear') {
    logEl.innerHTML = '';
    return;
  }
  let out = '';
  try {
    out = runCmd ? runCmd(line) : '';
  } catch (err) {
    print(String(err.message || err), 'err');
    return;
  }
  if (out) print(out, out.charAt(0) === '?' ? 'err' : '');
}

function hist(dir) {
  if (!history.length) return;
  if (histI === -1) draft = input.value;
  const next = histI === -1 ? history.length + dir : histI + dir;
  if (next < 0) return;
  if (next >= history.length) {
    histI = -1;
    input.value = draft;
    return;
  }
  histI = next;
  input.value = history[histI];
  input.setSelectionRange(input.value.length, input.value.length);
}
