import type { GlobalContext, KaiokenCtxFollowupFunc } from "./globalContext"
import {
  booleanAttributes,
  propFilters,
  propToHtmlAttr,
  svgTags,
} from "./utils.js"
import { cleanupHook } from "./hooks/utils.js"
import { EffectTag, elementTypes } from "./constants.js"
import { Component } from "./component.js"

export { commitWork, createDom }

type VNode = Kaioken.VNode

function createDom(vNode: VNode): HTMLElement | SVGElement | Text {
  const t = vNode.type as string
  let dom =
    t == elementTypes.text
      ? document.createTextNode(vNode.props?.nodeValue ?? "")
      : svgTags.includes(t)
        ? document.createElementNS("http://www.w3.org/2000/svg", t)
        : document.createElement(t)

  dom = updateDom(vNode, dom)
  vNode.dom = dom
  return dom
}

function handleAttributeRemoval(
  dom: Element,
  key: string,
  value: unknown,
  isBoolAttr = false
) {
  if (value === null) {
    dom.removeAttribute(key)
    return true
  }
  switch (typeof value) {
    case "undefined":
    case "function":
    case "symbol": {
      dom.removeAttribute(key)
      return true
    }
    case "boolean": {
      if (isBoolAttr && !value) {
        dom.removeAttribute(key)
        return true
      }
    }
  }

  return false
}

export function setDomAttribute(dom: Element, key: string, value: unknown) {
  const isBoolAttr = booleanAttributes.includes(key)

  if (handleAttributeRemoval(dom, key, value, isBoolAttr)) return

  dom.setAttribute(key, isBoolAttr ? "" : String(value))
}

function setProp(
  dom: HTMLElement | SVGElement,
  key: string,
  value: unknown,
  prev: unknown
) {
  switch (key) {
    case "style":
      setStyleProp(dom, value, prev)
      break
    default:
      setDomAttribute(dom, propToHtmlAttr(key), value)
  }
}

function setStyleProp(
  dom: HTMLElement | SVGElement,
  value: unknown,
  prev: unknown
) {
  if (handleAttributeRemoval(dom, "style", value)) return
  if (typeof value === "string") {
    dom.setAttribute("style", value)
    return
  }

  if (
    !!prev &&
    typeof prev === "object" &&
    !!value &&
    typeof value === "object"
  ) {
    Object.keys(prev).forEach((k) => {
      if (!(k in value)) dom.style[k as any] = ""
    })
  }

  if (typeof value !== "object" || !value) return

  Object.keys(value as Partial<CSSStyleDeclaration>).forEach(
    (k) => (dom.style[k as any] = value[k as keyof typeof value] as any)
  )
}

function updateDom(node: VNode, dom: HTMLElement | SVGElement | Text) {
  const prevProps: Record<string, any> = node.prev?.props ?? {}
  const nextProps: Record<string, any> = node.props ?? {}

  const keys = new Set([...Object.keys(prevProps), ...Object.keys(nextProps)])

  keys.forEach((key) => {
    if (propFilters.internalProps.includes(key)) return

    if (propFilters.isEvent(key) && prevProps[key] !== nextProps[key]) {
      const eventType = key.toLowerCase().substring(2)
      if (key in prevProps) dom.removeEventListener(eventType, prevProps[key])
      if (key in nextProps) dom.addEventListener(eventType, nextProps[key])
      return
    }

    if (!(dom instanceof Text)) {
      setProp(dom, key, nextProps[key], prevProps[key])
      return
    }
    if (node.prev?.props && prevProps.nodeValue !== nextProps.nodeValue) {
      dom.nodeValue = nextProps.nodeValue
    }
  })

  return dom
}

function commitWork(
  ctx: GlobalContext,
  vNode: VNode,
  domParent?: HTMLElement | SVGElement | Text,
  prevSibling?: VNode,
  prevSiblingDom?: HTMLElement | SVGElement | Text,
  commitSibling = false
): KaiokenCtxFollowupFunc[] {
  let domParentNode: VNode | undefined = vNode.parent ?? vNode.prev?.parent
  const dom = vNode.dom ?? vNode.instance?.rootDom
  if (
    dom &&
    (!dom.isConnected ||
      (vNode.effectTag === EffectTag.PLACEMENT && !vNode.instance?.rootDom))
  ) {
    // find mountable parent dom
    if (!domParent) {
      domParent = domParentNode?.instance?.rootDom ?? domParentNode?.dom
      while (domParentNode && !domParent) {
        domParentNode = domParentNode.parent
        domParent = domParentNode?.instance?.rootDom ?? domParentNode?.dom
      }
    }

    if (!domParent || !domParentNode) {
      console.error("[kaioken]: no domParent found - seek help!", vNode)
      return []
    }
    if (domParent.childNodes.length === 0) {
      domParent.appendChild(dom)
    } else {
      if (!prevSiblingDom && prevSibling) {
        prevSiblingDom = findMountedDomRecursive(prevSibling)
      }
      if (prevSiblingDom) {
        prevSiblingDom.after(dom)
      } else {
        domParent.appendChild(dom)
      }
    }
  } else if (
    vNode.effectTag === EffectTag.UPDATE &&
    dom &&
    !vNode.instance?.rootDom
  ) {
    updateDom(vNode, dom)
  } else if (vNode.effectTag === EffectTag.DELETION) {
    return commitDeletion(vNode, dom)
  }

  const followUpWork: KaiokenCtxFollowupFunc[] = []
  const { child, sibling } = vNode
  child &&
    followUpWork.push((ctx: GlobalContext) =>
      commitWork(ctx, child, dom, prevSibling, undefined, true)
    )
  commitSibling &&
    sibling &&
    followUpWork.push((ctx: GlobalContext) =>
      commitWork(ctx, sibling, domParent, vNode, dom, true)
    )

  const instance = vNode.instance
  if (instance) {
    const onMounted = instance.componentDidMount?.bind(instance)
    if (!vNode.prev && onMounted) {
      ctx.queueEffect(onMounted)
    } else if (vNode.effectTag === EffectTag.UPDATE) {
      const onUpdated = instance.componentDidUpdate?.bind(instance)
      if (onUpdated) ctx.queueEffect(onUpdated)
    }
  }

  if (vNode.props.ref && dom) {
    vNode.props.ref.current = dom
  }
  vNode.effectTag = undefined
  vNode.prev = { ...vNode, prev: undefined }
  return followUpWork
}

function findMountedDomRecursive(
  vNode: VNode,
  includeSibling = false
): HTMLElement | SVGElement | Text | undefined {
  if (vNode.dom?.isConnected) return vNode.dom
  if (vNode.child) {
    const dom = findMountedDomRecursive(vNode.child, true)
    if (dom) return dom
  }
  if (includeSibling && vNode.sibling)
    return findMountedDomRecursive(vNode.sibling, true)
  return undefined
}

function commitDeletion(
  vNode: VNode,
  dom = vNode.dom,
  deleteSibling = false
): KaiokenCtxFollowupFunc[] {
  if (Component.isCtor(vNode.type) && vNode.instance) {
    vNode.instance.componentWillUnmount?.()
  } else if (vNode.type instanceof Function) {
    while (vNode.hooks?.length) cleanupHook(vNode.hooks.pop()!)
  }

  if (dom) {
    if (dom.isConnected && vNode.instance?.rootDom !== dom) dom.remove()
    delete vNode.dom
  }
  const followUps: KaiokenCtxFollowupFunc[] = []
  const { child, sibling } = vNode
  child && followUps.push(() => commitDeletion(child, undefined, true))
  deleteSibling &&
    sibling &&
    followUps.push(() => commitDeletion(sibling, undefined, true))

  return followUps
}
