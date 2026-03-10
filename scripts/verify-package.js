#!/usr/bin/env node
/**
 * Verify package contents before publishing
 *
 * This script ensures that critical files are included in the npm package,
 * specifically the web UI dist files that are required for the admin interface.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REQUIRED_FILES = [
  'dist/cli.js',
  'bin/llamacpp',
  'dist/launchers/llamacpp-server',
  'web/dist/index.html',
  'web/dist/assets',
];

const REQUIRED_WEB_ASSETS = [
  'index.html',
  'vite.svg',
];

console.log('🔍 Verifying package contents...\n');

let hasErrors = false;

// Check if required files exist
for (const file of REQUIRED_FILES) {
  const filePath = path.join(__dirname, '..', file);
  const exists = fs.existsSync(filePath);
  const icon = exists ? '✅' : '❌';
  console.log(`${icon} ${file}`);
  if (!exists) {
    hasErrors = true;
    console.error(`   ERROR: Required file missing: ${file}`);
  }
}

// Check if wrapper script is executable
const wrapperPath = path.join(__dirname, '..', 'dist', 'launchers', 'llamacpp-server');
if (fs.existsSync(wrapperPath)) {
  try {
    fs.accessSync(wrapperPath, fs.constants.X_OK);
    console.log('✅ dist/launchers/llamacpp-server is executable');
  } catch {
    hasErrors = true;
    console.error('❌ dist/launchers/llamacpp-server is NOT executable');
    console.error('   Run: chmod +x dist/launchers/llamacpp-server');
  }
}

// Check if web/dist/assets has JS and CSS files
const assetsDir = path.join(__dirname, '..', 'web', 'dist', 'assets');
if (fs.existsSync(assetsDir)) {
  const files = fs.readdirSync(assetsDir);
  const hasJS = files.some(f => f.endsWith('.js'));
  const hasCSS = files.some(f => f.endsWith('.css'));

  if (hasJS && hasCSS) {
    console.log('✅ web/dist/assets contains JS and CSS bundles');
  } else {
    hasErrors = true;
    console.error('❌ web/dist/assets is missing JS or CSS files');
    console.error('   Found files:', files);
  }
}

// Verify package size is reasonable (should be >300KB with web UI)
try {
  // Dry-run pack to check size without creating tarball
  const output = execSync('npm pack --dry-run 2>&1', { encoding: 'utf-8' });
  const sizeMatch = output.match(/package size:\s+([\d.]+)\s*([kMG]B)/);

  if (sizeMatch) {
    const size = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2];

    // Convert to KB for comparison
    let sizeKB = size;
    if (unit === 'MB') sizeKB = size * 1024;
    if (unit === 'GB') sizeKB = size * 1024 * 1024;

    console.log(`\n📦 Package size: ${size} ${unit}`);

    if (sizeKB < 300) {
      hasErrors = true;
      console.error('❌ Package size is too small! Web UI files may be missing.');
      console.error('   Expected: >300 KB (with web UI)');
      console.error('   Got: ' + sizeKB.toFixed(1) + ' KB');
    } else {
      console.log('✅ Package size looks good (includes web UI)');
    }

    // Show file count
    const filesMatch = output.match(/total files:\s+(\d+)/);
    if (filesMatch) {
      const fileCount = parseInt(filesMatch[1]);
      console.log(`📄 Total files: ${fileCount}`);

      if (fileCount < 295) {
        console.warn('⚠️  File count is lower than expected (should be ~300 with web UI)');
      }
    }
  }

  // Verify web/dist files are in the tarball
  const tarballList = execSync('npm pack --dry-run 2>&1 | grep "web/dist"', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'ignore']
  }).trim();

  if (tarballList.includes('web/dist/index.html')) {
    console.log('✅ web/dist files found in package tarball');
  } else {
    hasErrors = true;
    console.error('❌ web/dist files NOT found in package tarball');
  }

} catch (error) {
  console.error('❌ Failed to verify package:', error.message);
  hasErrors = true;
}

console.log('\n' + '='.repeat(60));

if (hasErrors) {
  console.error('❌ VERIFICATION FAILED - DO NOT PUBLISH');
  console.error('\nTo fix:');
  console.error('  1. Run: cd web && npm install && npm run build');
  console.error('  2. Verify web/.gitignore does NOT exclude dist/');
  console.error('  3. Check package.json "files" field includes "web/dist/"');
  console.error('  4. Run this script again: npm run verify-package\n');
  process.exit(1);
} else {
  console.log('✅ ALL CHECKS PASSED - Package is ready to publish!\n');
  process.exit(0);
}
