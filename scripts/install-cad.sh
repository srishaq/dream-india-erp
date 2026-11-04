#!/bin/sh
# Vercel install step: the CAD viewer packages (build-time only; the ERP itself uses no outside packages)
npm view @mlightcad/cad-simple-viewer@1.7.8 peerDependencies dependencies --json
npm view @mlightcad/libredwg-converter@3.15.22 peerDependencies dependencies --json
rm -rf node_modules && npm install --no-audit --no-fund --legacy-peer-deps
