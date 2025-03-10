import { test, assert, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { finder } from '../finder.js'

import 'css.escape'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function check({ file, html, query }, config = {}) {
  config = {
    timeoutMs: Infinity,
    maxNumberOfPathChecks: 2_000,
    ...config,
  }
  const dom = file
    ? new JSDOM(readFileSync(path.join(__dirname, file), 'utf8'))
    : new JSDOM(html)
  globalThis.document = dom.window.document
  globalThis.Node = dom.window.Node
  const selectors = []
  for (let node of document.querySelectorAll(query ?? '*')) {
    let css
    try {
      css = finder(node, config)
    } catch (err) {
      assert.ok(
        false,
        err.toString() +
          '\n    Stack:' +
          err.stack +
          '\n    Node: ' +
          node.outerHTML.substring(0, 100),
      )
    }
    assert.equal(
      document.querySelectorAll(css).length,
      1,
      `Selector "${css}" selects more then one node.`,
    )
    assert.equal(
      document.querySelector(css),
      node,
      `Selector "${css}" selects another node.`,
    )
    selectors.push(css)
  }
  expect(selectors).toMatchSnapshot()
}

test('github', () => {
  check({ file: 'pages/github.com.html' })
})

test('stripe', () => {
  check({ file: 'pages/stripe.com.html' })
})

test('deployer', () => {
  check({ file: 'pages/deployer.org.html' })
})

test('tailwindcss', () => {
  check({ file: 'pages/tailwindcss.html' })
})

test('google', () => {
  check({
    file: 'pages/google.com.html',
    query: '[href]',
  })
})

test('duplicate', () => {
  const html = `

  <div id="foo"></div>
  <div id="foo"></div>
  `
  check({ html })
})

test('duplicate:sub-nodes', () => {
  const html = `
  <div id="foo"><i></i></div>
  <div id="foo"><i></i></div>
  `
  check({ html })
})

test('bad-class-names', () => {
  const html = `
  <div class="css-175oi2r"></div>
  <div class="css-y6a5a9i"></div>
  `
  check({ html })
})
