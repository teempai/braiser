import { readFile, writeFile, mkdir, copyFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = resolve(rootDir, 'dist');

async function prepareExtension() {
  try {
    // Create necessary directories
    await mkdir(resolve(distDir, 'assets'), { recursive: true });
    await mkdir(resolve(distDir, 'background'), { recursive: true });
    await mkdir(resolve(distDir, 'content'), { recursive: true });
    await mkdir(resolve(distDir, 'popup'), { recursive: true });

    // Copy manifest.json to dist
    const manifestPath = resolve(rootDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(
      resolve(distDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    // Copy icons
    const iconSizes = ['16', '48', '128'];
    for (const size of iconSizes) {
      try {
        const iconPath = resolve(rootDir, `src/assets/icon${size}.png`);
        const destPath = resolve(distDir, `assets/icon${size}.png`);
        await copyFile(iconPath, destPath);
      } catch (err) {
        console.warn(`Warning: Could not create icon${size}.png - ${err.message}`);
      }
    }

    // Copy and update popup HTML
    const popupHtmlSrc = resolve(rootDir, 'src/popup/index.html');
    const popupHtmlDest = resolve(distDir, 'popup/index.html');
    
    let htmlContent = await readFile(popupHtmlSrc, 'utf8');
    
    // Update script and style paths
    htmlContent = htmlContent
      .replace('src="./main.tsx"', 'src="popup.js"')
      .replace('href="popup.css"', 'href="popup.css"');
    
    await writeFile(popupHtmlDest, htmlContent);

    console.log('Extension files prepared successfully!');
  } catch (error) {
    console.error('Error preparing extension files:', error);
    process.exit(1);
  }
}

prepareExtension();