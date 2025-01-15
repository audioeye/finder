// License: MIT
// Author: Anton Medvedev <anton@medv.io>
// Source: https://github.com/antonmedv/finder

type Knot = {
  name: string
  penalty: number
  level?: number
}

const acceptedAttrNames = new Set(['role', 'name', 'aria-label', 'rel', 'href'])

/** Check if attribute name and value are word-like. */
export function attr(name: string, value: string): boolean {
  let nameIsOk = acceptedAttrNames.has(name)
  nameIsOk ||= name.startsWith('data-') && wordLike(name)

  let valueIsOk = wordLike(value) && value.length < 100
  valueIsOk ||= value.startsWith('#') && wordLike(value.slice(1))

  return nameIsOk && valueIsOk
}

/** Check if id name is word-like. */
export function idName(name: string): boolean {
  return wordLike(name)
}

/** Check if class name is word-like. */
export function className(name: string): boolean {
  return wordLike(name)
}

/** Check if tag name is word-like. */
export function tagName(name: string): boolean {
  return true
}

/** Configuration options for the finder. */
export type Options = {
  /** The root element to start the search from. */
  root?: Element
  /** Function that determines if an id name may be used in a selector. */
  idName?: (name: string) => boolean
  /** Function that determines if a class name may be used in a selector. */
  className?: (name: string) => boolean
  /** Function that determines if a tag name may be used in a selector. */
  tagName?: (name: string) => boolean
  /** Function that determines if an attribute may be used in a selector. */
  attr?: (name: string, value: string) => boolean
  /** Timeout to search for a selector. */
  timeoutMs?: number
  /** Minimum length of levels in fining selector. */
  seedMinLength?: number
  /** Minimum length for optimising selector. */
  optimizedMinLength?: number
  /** Maximum number of path checks. */
  maxNumberOfPathChecks?: number
}

/** Finds unique CSS selectors for the given element. */
export function finder(
  initialInput: Element | Element[],
  options?: Partial<Options>,
): string {
  const input = Array.isArray(initialInput) ? initialInput : [initialInput]
  if (input.some((element) => element.nodeType !== Node.ELEMENT_NODE)) {
    throw new Error(`Can't generate CSS selector for non-element node type.`)
  }
  if (input.every((element) => element.tagName.toLowerCase() === 'html')) {
    return 'html'
  }
  const defaults: Required<Options> = {
    root: document.body,
    idName: idName,
    className: className,
    tagName: tagName,
    attr: attr,
    timeoutMs: 1000,
    seedMinLength: 3,
    optimizedMinLength: 2,
    maxNumberOfPathChecks: Infinity,
  }

  const startTime = new Date()
  const config: Required<Options> = { ...defaults, ...options }
  const rootDocument = findRootDocument(config.root, defaults)

  let foundPaths: Knot[][] = []
  let count = 0
  for (const candidate of search(input, config, rootDocument)) {
    const elapsedTimeMs = new Date().getTime() - startTime.getTime()
    if (
      elapsedTimeMs > config.timeoutMs ||
      count >= config.maxNumberOfPathChecks
    ) {
      if (foundPaths.length) {
        break
      }

      const fPath = fallback(input, rootDocument)
      if (!fPath) {
        throw new Error(
          `Timeout: Can't find a unique selector after ${config.timeoutMs}ms`,
        )
      }
      return selector(fPath)
    }
    count++
    if (unique(candidate, input, rootDocument)) {
      foundPaths.push(candidate)
      if (input.length === 1) {
        break
      }
    }
  }

  if (foundPaths.length === 0) {
    throw new Error(`Selector was not found.`)
  }

  foundPaths.sort(byPenalty)

  const [firstPath, ...otherPaths] = foundPaths
  const initialOptimized = [
    firstPath,
    ...optimize(firstPath, input, config, rootDocument, startTime),
  ]
  initialOptimized.sort(byPenalty)
  let optimized = initialOptimized
  if (input.length > 1) {
    const firstOptimizedPath = initialOptimized[0]!
    const maxPenaltyLength = penalty(firstOptimizedPath)
    const maxLength = firstOptimizedPath.length

    const otherPermutations = otherPaths
      .map((foundPath) => [
        ...permuations({
          path: foundPath,
          input,
          maximumLength: maxLength,
          maximumScore: maxPenaltyLength,
          rootDocument,
        }),
      ])
      .flat()

    optimized = otherPermutations
      .map((foundPath) => [
        foundPath,
        ...optimize(foundPath, input, config, rootDocument, startTime),
      ])
      .flat()
    // Add other viable permutations
    optimized.push(firstOptimizedPath)
    optimized.sort(byPenalty)
  }

  if (optimized.length > 0) {
    return selector(optimized[0])
  }
  return selector(foundPaths[0])
}

function* search(
  input: Element[],
  config: Required<Options>,
  rootDocument: Element | Document,
): Generator<Knot[]> {
  const stack: Knot[][] = []
  let paths: Knot[][] = []
  let current: Element | null = input[0]
  let i = 0
  while (current && current !== rootDocument) {
    const level = tie(current, config)
    for (const node of level) {
      node.level = i
    }
    stack.push(level)
    current = current.parentElement
    i++

    paths.push(...combinations(stack))

    if (i >= config.seedMinLength) {
      paths.sort(byPenalty)
      for (const candidate of paths) {
        yield candidate
      }
      paths = []
    }
  }

  paths.sort(byPenalty)

  for (const candidate of paths) {
    yield candidate
  }
}

function wordLike(name: string): boolean {
  if (/^[a-z\-]{3,}$/i.test(name)) {
    const words = name.split(/-|[A-Z]/)
    for (const word of words) {
      if (word.length <= 2) {
        return false
      }
      if (/[^aeiou]{4,}/i.test(word)) {
        return false
      }
    }
    return true
  }
  return false
}

function tie(element: Element, config: Required<Options>): Knot[] {
  const level: Knot[] = []

  const elementId = element.getAttribute('id')
  if (elementId && config.idName(elementId)) {
    level.push({
      name: '#' + CSS.escape(elementId),
      penalty: 0,
    })
  }

  for (let i = 0; i < element.classList.length; i++) {
    const name = element.classList[i]
    if (config.className(name)) {
      level.push({
        name: '.' + CSS.escape(name),
        penalty: 1,
      })
    }
  }

  for (let i = 0; i < element.attributes.length; i++) {
    const attr = element.attributes[i]
    if (attr.name === 'class') {
      continue
    }
    if (config.attr(attr.name, attr.value)) {
      level.push({
        name: `[${CSS.escape(attr.name)}="${CSS.escape(attr.value)}"]`,
        penalty: 2,
      })
    }
  }

  const tagName = element.tagName.toLowerCase()
  if (config.tagName(tagName)) {
    level.push({
      name: tagName,
      penalty: 5,
    })

    const index = indexOf(element, tagName)
    if (index !== undefined) {
      level.push({
        name: nthOfType(tagName, index),
        penalty: 10,
      })
    }
  }

  const nth = indexOf(element)
  if (nth !== undefined) {
    level.push({
      name: nthChild(tagName, nth),
      penalty: 50,
    })
  }

  return level
}

function selector(path: Knot[]): string {
  let node = path[0]
  let query = node.name
  for (let i = 1; i < path.length; i++) {
    const level = path[i].level || 0
    if (node.level === level - 1) {
      query = `${path[i].name} > ${query}`
    } else {
      query = `${path[i].name} ${query}`
    }
    node = path[i]
  }
  return query
}

function penalty(path: Knot[]): number {
  return path.map((node) => node.penalty).reduce((acc, i) => acc + i, 0)
}

function byPenalty(a: Knot[], b: Knot[]) {
  return penalty(a) - penalty(b)
}

function indexOf(input: Element, tagName?: string): number | undefined {
  const parent = input.parentNode
  if (!parent) {
    return undefined
  }
  let child = parent.firstChild
  if (!child) {
    return undefined
  }
  let i = 0
  while (child) {
    if (
      child.nodeType === Node.ELEMENT_NODE &&
      (tagName === undefined ||
        (child as Element).tagName.toLowerCase() === tagName)
    ) {
      i++
    }
    if (child === input) {
      break
    }
    child = child.nextSibling
  }
  return i
}

function fallback(input: Element[], rootDocument: Element | Document) {
  let i = 0
  let current: Element | null = input[0]
  const path: Knot[] = []
  while (current && current !== rootDocument) {
    const tagName = current.tagName.toLowerCase()
    const index = indexOf(current, tagName)
    if (index === undefined) {
      return
    }
    path.push({
      name: nthOfType(tagName, index),
      penalty: NaN,
      level: i,
    })
    current = current.parentElement
    i++
  }
  if (unique(path, input, rootDocument)) {
    return path
  }
}

function nthChild(tagName: string, index: number) {
  if (tagName === 'html') {
    return 'html'
  }
  return `${tagName}:nth-child(${index})`
}

function nthOfType(tagName: string, index: number) {
  if (tagName === 'html') {
    return 'html'
  }
  return `${tagName}:nth-of-type(${index})`
}

function* combinations(stack: Knot[][], path: Knot[] = []): Generator<Knot[]> {
  if (stack.length > 0) {
    for (let node of stack[0]) {
      yield* combinations(stack.slice(1, stack.length), path.concat(node))
    }
  } else {
    yield path
  }
}

function findRootDocument(rootNode: Element | Document, defaults: Options) {
  if (rootNode.nodeType === Node.DOCUMENT_NODE) {
    return rootNode
  }
  if (rootNode === defaults.root) {
    return rootNode.ownerDocument as Document
  }
  return rootNode
}

function unique(
  path: Knot[],
  elementsToMatch: Element[],
  rootDocument: Element | Document,
) {
  const css = selector(path)
  const foundElements = Array.from(rootDocument.querySelectorAll(css))

  if (foundElements.length === 0) {
    throw new Error(`Can't select any node with this selector: ${css}`)
  }

  return (
    foundElements.length === elementsToMatch.length &&
    elementsToMatch.every((element) => foundElements.includes(element))
  )
}

function* optimize(
  path: Knot[],
  input: Element[],
  config: Required<Options>,
  rootDocument: Element | Document,
  startTime: Date,
): Generator<Knot[]> {
  if (path.length > 2 && path.length > config.optimizedMinLength) {
    for (let i = 1; i < path.length - 1; i++) {
      const elapsedTimeMs = new Date().getTime() - startTime.getTime()
      if (elapsedTimeMs > config.timeoutMs) {
        return
      }
      const newPath = [...path]
      newPath.splice(i, 1)
      if (unique(newPath, input, rootDocument)) {
        yield newPath
        yield* optimize(newPath, input, config, rootDocument, startTime)
      }
    }
  }
}

function* permuations({
  path,
  input,
  maximumLength,
  rootDocument,
  maximumScore,
}: {
  path: Knot[]
  input: Element[]
  maximumLength: number
  maximumScore: number
  rootDocument: Element | Document
}): Generator<Knot[]> {
  if (path.length > maximumLength) {
    for (let i = 1; i < path.length - 1; i++) {
      const newPath = [...path]
      newPath.splice(i, 1)

      yield* permuations({
        path: newPath,
        input,
        maximumLength,
        rootDocument,
        maximumScore,
      })
    }
  }
  if (penalty(path) < maximumScore && unique(path, input, rootDocument)) {
    yield path
  }
}
