// https://pomb.us/build-your-own-react/
// https://www.youtube.com/watch?v=YfnPk3nzWts
import type { VNode } from "./types"

export function createElement(
  type: string | Function,
  props = {},
  ...children: VNode[]
): VNode {
  return {
    type,
    props: {
      ...props,
      children: children
        .flat()
        .map((child) =>
          typeof child === "object" ? child : createTextElement(child)
        ),
    },
    hooks: [],
  }
}

function createTextElement(text: string): VNode {
  return {
    type: "TEXT_ELEMENT",
    props: {
      nodeValue: text,
      children: [],
    },
    hooks: [],
  }
}

function createDom(vNode: VNode): HTMLElement | Text {
  const dom =
    vNode.type == "TEXT_ELEMENT"
      ? document.createTextNode("")
      : document.createElement(vNode.type as string)

  updateDom(dom, {}, vNode.props)

  return dom
}

type Rec = Record<string, any>

const isEvent = (key: string) => key.startsWith("on")
const isProperty = (key: string) => key !== "children" && !isEvent(key)
const isNew = (prev: Rec, next: Rec) => (key: string) => prev[key] !== next[key]
const isGone = (_prev: Rec, next: Rec) => (key: string) => !(key in next)

function updateDom(
  dom: HTMLElement | Text,
  prevProps: Rec,
  nextProps: Rec = {}
) {
  //Remove old or changed event listeners
  Object.keys(prevProps)
    .filter(isEvent)
    .filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2)
      dom.removeEventListener(eventType, prevProps[name])
    })

  // Remove old properties
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach((name) => {
      // @ts-ignore
      dom[name] = ""
    })

  // Set new or changed properties
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      // @ts-ignore
      dom[name] = nextProps[name]
    })

  // Add event listeners
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach((name) => {
      const eventType = name.toLowerCase().substring(2)
      dom.addEventListener(eventType, nextProps[name])
    })
}

function commitRoot() {
  deletions.forEach(commitWork)
  commitWork(wipRoot?.child)
  currentRoot = wipRoot
  while (pendingEffects.length) pendingEffects.pop()?.()
  wipRoot = undefined
}

function commitWork(vNode?: VNode) {
  if (!vNode) {
    return
  }

  let domParentNode = vNode.parent
  while (!domParentNode?.dom) {
    domParentNode = domParentNode?.parent
  }
  const domParent = domParentNode.dom

  if (vNode.effectTag === "PLACEMENT" && vNode.dom != null) {
    domParent.appendChild(vNode.dom)
  } else if (vNode.effectTag === "UPDATE" && vNode.dom != null) {
    updateDom(vNode.dom, vNode.alternate?.props ?? {}, vNode.props)
  } else if (vNode.effectTag === "DELETION") {
    commitDeletion(vNode, domParent)
    return
  }

  commitWork(vNode.child)
  commitWork(vNode.sibling)
}

function commitDeletion(vNode: VNode, domParent: HTMLElement | Text) {
  if (vNode.dom) {
    domParent.removeChild(vNode.dom)
  } else if (vNode.child) {
    commitDeletion(vNode.child, domParent)
  }
}

export function render(appFunc: () => VNode, container: HTMLElement) {
  const app = appFunc()
  app.type = appFunc
  wipRoot = {
    dom: container,
    props: {
      children: [app],
    },
    alternate: currentRoot,
    hooks: [],
  }
  deletions = []
  nextUnitOfWork = wipRoot
}

let nextUnitOfWork: VNode | undefined = undefined
let currentRoot: VNode | undefined = undefined
let wipRoot: VNode | undefined = undefined
let deletions: VNode[] = []
let pendingEffects: Function[] = []

function workLoop(deadline: IdleDeadline) {
  let shouldYield = false
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork)
    shouldYield = deadline.timeRemaining() < 1
  }

  if (!nextUnitOfWork && wipRoot) {
    commitRoot()
  }

  requestIdleCallback(workLoop)
}

requestIdleCallback(workLoop)

function performUnitOfWork(vNode: VNode): VNode | undefined {
  const isFunctionComponent = vNode.type instanceof Function
  if (isFunctionComponent) {
    updateFunctionComponent(vNode)
  } else {
    updateHostComponent(vNode)
  }
  if (vNode.child) {
    return vNode.child
  }
  let nextNode: VNode | undefined = vNode
  while (nextNode) {
    if (nextNode.sibling) {
      return nextNode.sibling
    }
    nextNode = nextNode.parent
  }
  return
}

let wipNode: VNode | null = null
let hookIndex: number = -1

function updateFunctionComponent(vNode: VNode) {
  wipNode = vNode
  hookIndex = 0

  wipNode.hooks = []
  const children = [(vNode.type as Function)(vNode.props)]
  reconcileChildren(vNode, children)
}

export function useState<T>(initial: T) {
  const oldHook =
    wipNode!.alternate &&
    wipNode!.alternate.hooks &&
    wipNode!.alternate.hooks[hookIndex]

  const hook = {
    state: oldHook ? oldHook.state : initial,
    queue: [] as Function[],
  }

  const actions = oldHook ? oldHook.queue : []
  actions.forEach((action: Function) => {
    hook.state = action(hook.state)
  })

  const setState = (action: T | ((oldVal: T) => T)) => {
    if (!currentRoot) throw new Error("currentRoot is undefined, why???")
    hook.queue.push(typeof action === "function" ? action : () => action)
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot,
      hooks: [],
    }
    nextUnitOfWork = wipRoot
    deletions = []
  }

  wipNode?.hooks.push(hook)
  hookIndex++
  return [hook.state, setState] as const
}

export function useEffect(callback: Function, deps: any[] = []) {
  const oldHook =
    wipNode?.alternate &&
    wipNode.alternate.hooks &&
    wipNode.alternate.hooks[hookIndex]

  const hasChangedDeps =
    deps.length === 0 ||
    (!!oldHook && !deps.every((dep, i) => dep === oldHook.deps[i]))

  if (hasChangedDeps) {
    pendingEffects.push(callback)
  }

  wipNode?.hooks.push({
    deps,
    callback,
  })
  hookIndex++
}

function updateHostComponent(vNode: VNode) {
  if (!vNode.dom) {
    vNode.dom = createDom(vNode)
  }
  reconcileChildren(vNode, vNode.props.children)
}

function reconcileChildren(wipNode: VNode, children: VNode[]) {
  let index = 0
  let oldNode: VNode | undefined = wipNode.alternate && wipNode.alternate.child
  let prevSibling: VNode | undefined = undefined

  while (index < children.length || oldNode != null) {
    const child = children[index]
    let newNode = undefined

    const sameType = oldNode && child && child.type == oldNode.type

    if (sameType) {
      newNode = {
        type: oldNode!.type,
        props: child.props,
        dom: oldNode!.dom,
        parent: wipNode,
        alternate: oldNode,
        effectTag: "UPDATE",
        hooks: oldNode!.hooks,
      }
    }
    if (child && !sameType) {
      newNode = {
        type: child.type,
        props: child.props,
        dom: undefined,
        parent: wipNode,
        alternate: undefined,
        effectTag: "PLACEMENT",
        hooks: [],
      }
    }
    if (oldNode && !sameType) {
      oldNode.effectTag = "DELETION"
      deletions.push(oldNode)
    }

    if (oldNode) {
      oldNode = oldNode.sibling
    }

    if (index === 0) {
      wipNode.child = newNode
    } else if (child) {
      prevSibling!.sibling = newNode
    }

    prevSibling = newNode
    index++
  }
}

export function fragment(props: { children: VNode[] }) {
  return {
    type: "fragment",
    props,
  }
}

/** @jsx Didact.createElement */
// function Counter() {
//   const [state, setState] = Didact.useState(1)
//   return <h1 onClick={() => setState((c) => c + 1)}>Count: {state}</h1>
// }
// const element = <Counter />
// const container = document.getElementById("root")
// Didact.render(element, container)
