const { copyFileSync, lstatSync, mkdirSync, readdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const output = join(__dirname, 'dist');
const publicFiles = new Set([
  'index.html', 'pds/index.html',
  'style.css', 'cover.css', 'diary-auth.css', 'diary-navigation.css', 'pds.css',
  'app.js', 'cover.js', 'holidays.js',
  'diary-account.js', 'diary-auth.js', 'diary-cloud.js',
  'pds-model.js', 'pds-storage.js', 'pds-web.js',
  'assets/login-rabbit.svg', 'assets/rabbit-flowers.svg'
]);

function verifyOutput(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isFile() && publicFiles.has(relative)) continue;
    if (entry.isDirectory() && [...publicFiles].some(file => file.startsWith(relative + '/'))) {
      verifyOutput(join(directory, entry.name), relative + '/');
    } else {
      throw new Error(`Unexpected Vercel output: ${relative}`);
    }
  }
}

mkdirSync(output, { recursive: true });
if (!lstatSync(output).isDirectory()) throw new Error('Vercel output must be a directory.');
verifyOutput(output);
for (const file of publicFiles) {
  const target = join(output, file);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(__dirname, file), target);
}
console.log(`Prepared ${publicFiles.size} public files for Vercel.`);
