#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get package version
const packagePath = path.join(__dirname, '..', 'package.json');
const package = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const version = package.version;

// Get today's date
const today = new Date();
const monthNames = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const dateString = `${monthNames[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`;

// Update README
const readmePath = path.join(__dirname, '..', 'README.md');
let readme = fs.readFileSync(readmePath, 'utf8');

// Update version line
readme = readme.replace(
  /\*\*Current Version:\*\* .+/,
  `**Current Version:** ${version}  `
);

// Update date line
readme = readme.replace(
  /\*\*Go-Live Date:\*\* .+/,
  `**Go-Live Date:** ${dateString}`
);

// Write back
fs.writeFileSync(readmePath, readme);

console.log(`✅ Updated README.md with version ${version} and date ${dateString}`);