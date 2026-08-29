const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/<script>\n([\s\S]*)\n<\/script>\s*<\/body>/);
if (!match) {
  console.error('Could not find inline app script');
  process.exit(1);
}
const tmp = '/tmp/goodbutnotgreedy-inline.js';
fs.writeFileSync(tmp, match[1]);
require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'inherit' });
console.log('index.html inline JavaScript syntax OK');
