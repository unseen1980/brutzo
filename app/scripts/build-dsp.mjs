#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const crate = path.join(appRoot, 'dsp', 'tone-core')
execFileSync('cargo', ['build', '--manifest-path', path.join(crate, 'Cargo.toml'), '--release', '--target', 'wasm32-unknown-unknown'], { stdio: 'inherit' })
const source = path.join(crate, 'target', 'wasm32-unknown-unknown', 'release', 'brutzo_tone_core.wasm')
const destination = path.join(appRoot, 'public', 'audio', 'brutzo_tone_core.wasm')
fs.mkdirSync(path.dirname(destination), { recursive: true })
fs.copyFileSync(source, destination)
console.log(`Copied tone WASM (${fs.statSync(destination).size} bytes)`)
