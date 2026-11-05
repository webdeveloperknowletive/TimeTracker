const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

console.log('Packaging Knowletive Chrome Extension...');

const rootDir = __dirname;
const scriptPath = path.join(rootDir, '_temp_zip.py');

const pyScript = `
import zipfile, os

root_dir = r"${rootDir.replace(/\\/g, '/')}"
files = [
    ("manifest.json", "manifest.json"),
    ("popup.html", "popup.html"),
    ("popup.css", "popup.css"),
    ("dist/background.js", "dist/background.js"),
    ("dist/popup.js", "dist/popup.js"),
    ("icons/icon16.png", "icons/icon16.png"),
    ("icons/icon48.png", "icons/icon48.png"),
    ("icons/icon128.png", "icons/icon128.png"),
]
targets = [
    os.path.abspath(os.path.join(root_dir, "../knowletive-frontend/public/knowletive-extension.zip")),
    os.path.abspath(os.path.join(root_dir, "../knowletive-backend/tracker/static/knowletive-extension.zip")),
]

for t_path in targets:
    os.makedirs(os.path.dirname(t_path), exist_ok=True)
    with zipfile.ZipFile(t_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for src, arc in files:
            f_path = os.path.join(root_dir, src)
            if os.path.exists(f_path):
                zf.write(f_path, arc)
    print(f"Packaged: {t_path}")
`;

fs.writeFileSync(scriptPath, pyScript.trim(), 'utf-8');

try {
  execFileSync('python', [scriptPath], { stdio: 'inherit' });
  console.log('Chrome Extension packaged successfully!');
} finally {
  if (fs.existsSync(scriptPath)) {
    fs.unlinkSync(scriptPath);
  }
}
