#!/bin/sh
# Vercel install step: the CAD viewer packages, at versions that fit together (build-time only; the ERP's
# server code uses no outside packages)
npm view @mlightcad/libredwg-converter@3.15.21 peerDependencies --json
rm -rf node_modules && npm install --no-audit --no-fund --legacy-peer-deps
